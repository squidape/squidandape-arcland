/*
 * Sets the flag that keeps every file's network/DOM layer from initialising, so
 * tests.html gets the pure functions and nothing else.
 *
 * External rather than inline so the page needs no inline-script exception in
 * the Content-Security-Policy — see website/_headers.
 */
window.__LANDBANK_TEST_ONLY__ = true;
