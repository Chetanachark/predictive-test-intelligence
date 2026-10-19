State observation degradation: temporarily stale rendered cart totals settle
before the unchanged expected-total invariant. Transient retry and final failure
stages leave the view stale beyond the assertion budget. No React state, pricing,
inventory or business logic is changed. This emulates a display consistency fault.
Implementation: ../scenarios.js, family state; version ../protocol.js.
