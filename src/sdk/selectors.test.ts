import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildNodes } from '../__tests__/test-utils/snapshot-builders.ts';
import { listSelectorChainMatches, parseSelectorChain, resolveSelectorChain } from './selectors.ts';

// The #3180 public-entry contract: `agent-device/selectors` hands out EVERY
// node the winning chain alternative matches — the domain a consumer applies
// its OWN strictness to — resolved through the package boundary itself, so a
// term-semantics or ordering drift in `@agent-device/selectors` lands here
// before it lands in a consumer that re-imports after a re-publish.

const loginNodes = () =>
  buildNodes([
    { index: 0, type: 'Window' },
    {
      index: 1,
      type: 'Button',
      label: 'Continue',
      identifier: 'auth_continue',
      rect: { x: 0, y: 80, width: 200, height: 44 },
      hittable: true,
    },
    { index: 2, type: 'Text', label: 'Skip', rect: { x: 0, y: 124, width: 200, height: 20 } },
    {
      index: 3,
      type: 'Button',
      label: 'Continue',
      identifier: 'secondary_continue',
      rect: { x: 0, y: 140, width: 200, height: 44 },
      hittable: true,
    },
    // Third "Continue" WITHOUT a rect: the closest negative for `requireRect`
    // — matched by default, refused when the caller requires geometry.
    { index: 4, type: 'Button', label: 'Continue', hittable: true },
  ]);

test('listSelectorChainMatches returns every node of the winning alternative, in snapshot order (#3180)', () => {
  const nodes = loginNodes();
  const match = listSelectorChainMatches(nodes, parseSelectorChain('label="Continue"'), {
    platform: 'ios',
  });
  assert.ok(match);
  assert.equal(match.selectorIndex, 0);
  assert.equal(match.selector.raw, 'label="Continue"');
  assert.deepEqual(
    match.matchedNodes.map((node) => node.ref),
    ['e2', 'e4', 'e5'],
  );
  // The matched nodes are the SAME objects, not copies — a consumer can
  // identity-compare them against its own snapshot.
  assert.equal(match.matchedNodes[0], nodes[1]);
});

test('listSelectorChainMatches reports several matches where resolveSelectorChain refuses, from the same chain', () => {
  const nodes = loginNodes();
  const chain = parseSelectorChain('label="Continue"');
  assert.equal(
    resolveSelectorChain(nodes, chain, { platform: 'ios', requireUnique: true }),
    null,
    'uniqueness refusal must not remove the matched nodes from the list',
  );
  const match = listSelectorChainMatches(nodes, chain, { platform: 'ios' });
  assert.equal(match?.matchedNodes.length, 3);
});

test('listSelectorChainMatches walks to the first alternative that matches, like resolution does', () => {
  const nodes = loginNodes();
  const match = listSelectorChainMatches(
    nodes,
    parseSelectorChain('label="Absent" || id=auth_continue'),
    { platform: 'ios' },
  );
  assert.ok(match);
  assert.equal(match.selectorIndex, 1);
  assert.deepEqual(
    match.matchedNodes.map((node) => node.ref),
    ['e2'],
  );
  // Both alternatives match here, so this is the pin that the walk returns the
  // FIRST one — the alternative `resolveSelectorChain` names — not the last.
  const both = listSelectorChainMatches(
    nodes,
    parseSelectorChain('label="Continue" || id=auth_continue'),
    { platform: 'ios' },
  );
  assert.equal(both?.selectorIndex, 0);
  assert.deepEqual(
    both?.matchedNodes.map((node) => node.ref),
    ['e2', 'e4', 'e5'],
  );
  assert.equal(
    listSelectorChainMatches(nodes, parseSelectorChain('label="Absent"'), { platform: 'ios' }),
    null,
  );
});

test('listSelectorChainMatches honors requireRect against the same geometry the resolver sees', () => {
  const nodes = loginNodes();
  const match = listSelectorChainMatches(nodes, parseSelectorChain('label="Continue"'), {
    platform: 'ios',
    requireRect: true,
  });
  assert.deepEqual(
    match?.matchedNodes.map((node) => node.ref),
    ['e2', 'e4'],
  );
});

test('listSelectorChainMatches uses agent-device term semantics, not the drifted consumer copy (#3180)', () => {
  // `hittable` requires an explicit true: the e2e copy counted absence as
  // true, so its list would LEAD with the non-hittable row.
  const hittableNodes = buildNodes([
    { index: 0, type: 'Button', label: 'Refresh' },
    {
      index: 1,
      type: 'Button',
      label: 'Refresh',
      rect: { x: 0, y: 40, width: 100, height: 40 },
      hittable: true,
    },
  ]);
  const hittable = listSelectorChainMatches(
    hittableNodes,
    parseSelectorChain('hittable=true label="Refresh"'),
    { platform: 'ios' },
  );
  assert.deepEqual(
    hittable?.matchedNodes.map((node) => node.ref),
    ['e2'],
  );

  // `text` is extractNodeText (FIRST non-empty of label/value/identifier),
  // not "label or value": e2 is NOT a text="Sign in" match because its label
  // wins and differs — the copy matched on either field.
  const textNodes = buildNodes([
    { index: 0, type: 'Button', label: 'Sign in' },
    { index: 1, type: 'Button', label: 'Other', value: 'Sign in' },
  ]);
  const text = listSelectorChainMatches(textNodes, parseSelectorChain('text="Sign in"'), {
    platform: 'android',
  });
  assert.deepEqual(
    text?.matchedNodes.map((node) => node.ref),
    ['e1'],
  );

  // `role` is the NORMALIZED native class: the consumer copy compared its own
  // mapped role, so an un-normalized `XCUIElementTypeButton` matched nothing.
  const roleNodes = buildNodes([
    { index: 0, type: 'XCUIElementTypeButton', label: 'OK' },
    { index: 1, type: 'XCUIElementTypeSwitch', label: 'Wi-Fi' },
  ]);
  const role = listSelectorChainMatches(roleNodes, parseSelectorChain('role="button"'), {
    platform: 'ios',
  });
  assert.deepEqual(
    role?.matchedNodes.map((node) => node.ref),
    ['e1'],
  );

  // `editable` is fillable-type + enabled, not "role is textbox": an Android
  // TextView the app marked as a textbox stays non-editable here.
  const editableNodes = buildNodes([
    { index: 0, type: 'android.widget.EditText', label: 'Name', enabled: true },
    { index: 1, type: 'android.widget.TextView', label: 'Note', role: 'textbox' },
    { index: 2, type: 'android.widget.EditText', label: 'Disabled', enabled: false },
  ]);
  const editable = listSelectorChainMatches(editableNodes, parseSelectorChain('editable=true'), {
    platform: 'android',
  });
  assert.deepEqual(
    editable?.matchedNodes.map((node) => node.ref),
    ['e1'],
  );

  // `visible` is isNodeVisible — hittable OR a non-empty rect — not a projected
  // hidden flag: a zero-size but hittable row stays visible, and a non-hittable
  // node with no geometry is hidden.
  const visibleNodes = buildNodes([
    {
      index: 0,
      type: 'Button',
      label: 'Row',
      hittable: true,
      rect: { x: 0, y: 0, width: 0, height: 0 },
    },
    { index: 1, type: 'Button', label: 'Row' },
  ]);
  const visible = listSelectorChainMatches(visibleNodes, parseSelectorChain('visible=true'), {
    platform: 'ios',
  });
  assert.deepEqual(
    visible?.matchedNodes.map((node) => node.ref),
    ['e1'],
  );
});
