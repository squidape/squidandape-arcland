/*
 * Top-100 richest Bitcoin addresses — a STATIC snapshot, not a live feed.
 *
 * Baked in as a JS constant rather than a JSON fetch: the site is opened straight
 * from disk during development, and file:// blocks fetch on same-directory files.
 * A snapshot also means this never breaks when a third party changes their HTML.
 *
 * Source:   https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html
 * Captured: 2026-08-04 (WIB)
 * Total:    3,087,162 BTC across 100 addresses = 14.70% of the 21,000,000 cap
 *
 * These are public on-chain addresses. Most of the largest are exchange or ETF
 * custody wallets holding coins for many people — NOT one person's stack.
 */

'use strict';

const WHALE_DATA = {"source":"https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html","captured":"2026-08-04","note":"Static snapshot. Addresses are public on-chain data; most large ones are exchange or ETF custody wallets, not individuals.","total_btc":3087162.0,"addresses":[{"rank":1,"address":"34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo","label":"Binance-coldwallet","btc":248598.0,"pct":"1.24%","since":"2018-10-18"},{"rank":2,"address":"3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6","label":"Binance-coldwallet","btc":185275.0,"pct":"0.9236%","since":"2018-11-13"},{"rank":3,"address":"bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2","label":"Robinhood-coldwallet","btc":140850.0,"pct":"0.7021%","since":"2023-05-08"},{"rank":4,"address":"bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97","label":"Bitfinex-coldwallet","btc":130010.0,"pct":"0.6481%","since":"2019-08-16"},{"rank":5,"address":"bc1qjasf9z3h7w3jspkhtgatgpyvvzgpa2wwd2lr0eh5tx44reyn2k7sfc27a4","label":"","btc":96932.0,"pct":"0.4832%","since":"2022-09-30"},{"rank":6,"address":"bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt","label":"Bitfinex-Hack-Recovery","btc":94643.0,"pct":"0.4718%","since":"2022-02-01"},{"rank":7,"address":"bc1qd4ysezhmypwty5dnw7c8nqy5h5nxg0xqsvaefd0qn5kq32vwnwqqgv4rzr","label":"","btc":91850.0,"pct":"0.4579%","since":"2021-10-11"},{"rank":8,"address":"1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF","label":"MtGox-Hack","btc":79957.0,"pct":"0.3986%","since":"2011-03-01"},{"rank":9,"address":"bc1q8yj0herd4r4yxszw3nkfvt53433thk0f5qst4g","label":"","btc":78317.0,"pct":"0.3904%","since":"2024-03-23"},{"rank":10,"address":"1Ay8vMC7R1UbyCCZRVULMV7iQpHSAbguJP","label":"Mr.100","btc":73470.0,"pct":"0.3662%","since":"2022-11-02"},{"rank":11,"address":"bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6","label":"SilkRoad-FBI-Confiscated","btc":69370.0,"pct":"0.3458%","since":"2020-11-03"},{"rank":12,"address":"3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb","label":"Binance-BTCB-Reserve","btc":68200.0,"pct":"0.3400%","since":"2019-06-17"},{"rank":13,"address":"bc1q0ymzksy046tv4z88ts5nmu7s574umnwmdev3rt","label":"","btc":62658.0,"pct":"0.3123%","since":"2025-08-20"},{"rank":14,"address":"3MgEAFWu1HKSnZ5ZsC8qf61ZW18xrP5pgd","label":"OKEx","btc":55905.0,"pct":"0.2787%","since":"2022-12-16"},{"rank":15,"address":"1LdRcdxfbSnmCYYNdeYpUnztiYzVfBEQeC","label":"","btc":53880.0,"pct":"0.2686%","since":"2014-05-27"},{"rank":16,"address":"1AC4fMwgY8j9onSbXEWeH6Zan8QGMSdmtA","label":"","btc":51830.0,"pct":"0.2584%","since":"2018-01-07"},{"rank":17,"address":"bc1qws342rlkhszh58rtn35zrw7w076puz83gkcufy","label":"","btc":48225.0,"pct":"0.2404%","since":"2025-09-23"},{"rank":18,"address":"bc1q0j55cut9nd2c88tnnsfultdx696c8lt6n4n0su","label":"","btc":44431.0,"pct":"0.2215%","since":"2026-03-05"},{"rank":19,"address":"1LruNZjwamWJXThX2Y8C2d47QqhAkkc5os","label":"","btc":44000.0,"pct":"0.2193%","since":"2019-11-24"},{"rank":20,"address":"bc1q4j7fcl8zx5yl56j00nkqez9zf3f6ggqchwzzcs5hjxwqhsgxvavq3qfgpr","label":"Coincheck","btc":42558.0,"pct":"0.2121%","since":"2024-02-02"},{"rank":21,"address":"bc1qa2eu6p5rl9255e3xz7fcgm6snn4wl5kdfh7zpt05qp5fad9dmsys0qjg0e","label":"","btc":38194.0,"pct":"0.1904%","since":"2024-06-30"},{"rank":22,"address":"3LQUu4v9z6KNch71j7kbj8GPeAGUo1FW6a","label":"Binance-coldwallet","btc":37927.0,"pct":"0.1891%","since":"2021-10-24"},{"rank":23,"address":"bc1qy3uw2kk45uj9vsy52rjfhydm2tnd6hreu8vha3","label":"","btc":37484.0,"pct":"0.1869%","since":"2025-08-19"},{"rank":24,"address":"bc1q7ydrtdn8z62xhslqyqtyt38mm4e2c4h3mxjkug","label":"UK-Gov-Confiscated","btc":36000.0,"pct":"0.1795%","since":"2021-07-27"},{"rank":25,"address":"bc1qeh5e4ndkrs9sxw8wed2yce69tkrg7t003rz4vk5jhkaf6knkem4q944qvt","label":"","btc":33087.0,"pct":"0.1649%","since":"2026-08-01"},{"rank":26,"address":"bc1qx9t2l3pyny2spqpqlye8svce70nppwtaxwdrp4","label":"Binance-Pool","btc":31643.0,"pct":"0.1577%","since":"2020-05-12"},{"rank":27,"address":"3FuhQLprN9s9MR3bZzR5da7mw75fuahsaU","label":"","btc":31461.0,"pct":"0.1568%","since":"2024-11-22"},{"rank":28,"address":"3FHNBLobJnbCTFTVakh5TXmEneyf5PT61B","label":"Binance-coldwallet","btc":31275.0,"pct":"0.1559%","since":"2021-07-26"},{"rank":29,"address":"12ib7dApVFvg82TXKycWBNpN8kFyiAN1dr","label":"967","btc":31000.0,"pct":"0.1545%","since":"2010-05-13"},{"rank":30,"address":"bc1q8taf2eca7pn9wu4czt8fgftqm288xtfxdyt33syzxuexxty733xsszghzk","label":"","btc":30800.0,"pct":"0.1535%","since":"2024-12-31"},{"rank":31,"address":"bc1qukw69mjxwp30adfqddv6gcyva26laxz562rhlk","label":"","btc":30467.0,"pct":"0.1519%","since":"2025-08-20"},{"rank":32,"address":"bc1q6h2v33qt0jjvpr2hxxtwhtvdvtn086g0n2qu06","label":"","btc":28203.0,"pct":"0.1406%","since":"2025-11-05"},{"rank":33,"address":"12tkqA9xSoowkzoERHMWNKsTey55YEBqkv","label":"","btc":28151.0,"pct":"0.1403%","since":"2010-04-05"},{"rank":34,"address":"3EMVdMehEq5SFipQ5UfbsfMsH223sSz9A9","label":"","btc":26984.0,"pct":"0.1345%","since":"2019-02-01"},{"rank":35,"address":"3FsDiWdG76meMpdCLbVV4dUXhrFyaLrtxL","label":"","btc":26916.0,"pct":"0.1342%","since":"2026-01-10"},{"rank":36,"address":"39eYrpgAgDhp4tTjrSb1ppZ5kdAc1ikBYw","label":"","btc":26062.0,"pct":"0.1299%","since":"2023-12-07"},{"rank":37,"address":"1N7jWmv63mkMdsYzbNUVHbEYDQfcq1u8Yp","label":"","btc":24052.0,"pct":"0.1199%","since":"2024-12-05"},{"rank":38,"address":"15cHRgVrGKz7qp2JL2N5mkB2MCFGLcnHxv","label":"","btc":23600.0,"pct":"0.1176%","since":"2022-06-16"},{"rank":39,"address":"bc1qr4dl5wa7kl8yu792dceg9z5knl2gkn220lk7a9","label":"Crypto.com-coldwallet","btc":23165.0,"pct":"0.1155%","since":"2022-03-04"},{"rank":40,"address":"bc1qs4z2d3h5je080f74tax92dwg08sf3hylj9vfg3","label":"","btc":21334.0,"pct":"0.1063%","since":"2026-01-22"},{"rank":41,"address":"bc1qx2x5cqhymfcnjtg902ky6u5t5htmt7fvqztdsm028hkrvxcl4t2sjtpd9l","label":"Bitbank-coldwallet","btc":20258.0,"pct":"0.1010%","since":"2022-07-22"},{"rank":42,"address":"17rm2dvb439dZqyMe2d4D6AQJSgg6yeNRn","label":"","btc":20008.0,"pct":"0.09974%","since":"2017-03-28"},{"rank":43,"address":"1PeizMg76Cf96nUQrYg8xuoZWLQozU5zGW","label":"","btc":19414.0,"pct":"0.09678%","since":"2010-07-24"},{"rank":44,"address":"bc1q72nyp6mzxjxm02j7t85pg0pq24684zdj2wuweu","label":"","btc":18520.0,"pct":"0.09232%","since":"2024-12-30"},{"rank":45,"address":"bc1p6mv2d3rpfhatkv77r6huuurgqyyklxpsnw3090k2qjwqtd6cwkcqzsruxt","label":"","btc":17800.0,"pct":"0.08873%","since":"2026-03-15"},{"rank":46,"address":"bc1qyt5gsrxp553v9fuwk8gugvspefamdphvf4xwup","label":"","btc":16350.0,"pct":"0.08150%","since":"2026-08-03"},{"rank":47,"address":"34HpHYiyQwg69gFmCq2BGHjF1DZnZnBeBP","label":"Binance-coldwallet","btc":16307.0,"pct":"0.08129%","since":"2021-10-22"},{"rank":48,"address":"38rFtDdFpXc4y6XPbSnNd2UvveEt5Xms2E","label":"","btc":16116.0,"pct":"0.08034%","since":"2025-12-08"},{"rank":49,"address":"bc1qlt5nm3kflne7rht4alsnzdzad878ld5rcu4na0","label":"","btc":16026.0,"pct":"0.07989%","since":"2024-10-14"},{"rank":50,"address":"1GR9qNz7zgtaW5HwwVpEJWMnGWhsbsieCG","label":"","btc":15746.0,"pct":"0.07849%","since":"2018-01-22"},{"rank":51,"address":"3FM9vDYsN2iuMPKWjAcqgyahdwdrUxhbJ3","label":"OKEx","btc":15379.0,"pct":"0.07666%","since":"2024-01-05"},{"rank":52,"address":"1BAuq7Vho2CEkVkUxbfU26LhwQjbCmWQkD","label":"","btc":15000.0,"pct":"0.07477%","since":"2022-01-29"},{"rank":53,"address":"1PJiGp2yDLvUgqeBsuZVCBADArNsk6XEiw","label":"","btc":14697.0,"pct":"0.07326%","since":"2023-12-21"},{"rank":54,"address":"bc1p4zxtwg3rhr5jqkzuvf0q03m2a69clydghqqz6arhldxln7ew0guq840aqm","label":"","btc":14400.0,"pct":"0.07178%","since":"2026-03-15"},{"rank":55,"address":"1CNtkWbb4grh8xtb8mhoZ6armNE9PHgzA8","label":"","btc":14228.0,"pct":"0.07092%","since":"2023-01-13"},{"rank":56,"address":"36X44rmLtk218sXACZ3gFpNMFENi6dQ2n3","label":"","btc":14157.0,"pct":"0.07057%","since":"2026-03-30"},{"rank":57,"address":"3KZbyboy2MKfQjDKKf2R4UdVbUKgYvso22","label":"","btc":13589.0,"pct":"0.06774%","since":"2026-03-16"},{"rank":58,"address":"bc1qsg6x2cvm75xuddn5g0ss9zglaamgz90q8vcp8w","label":"","btc":13514.0,"pct":"0.06737%","since":"2025-08-29"},{"rank":59,"address":"bc1qvrwzs8unvu35kcred2z5ujjef36s5jgf3y6tp8","label":"","btc":13108.0,"pct":"0.06534%","since":"2025-10-15"},{"rank":60,"address":"39gUvGynQ7Re3i15G3J2gp9DEB9LnLFPMN","label":"","btc":13077.0,"pct":"0.06519%","since":"2021-02-24"},{"rank":61,"address":"bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa","label":"UK-Gov-Confiscated","btc":13003.0,"pct":"0.06482%","since":"2021-07-27"},{"rank":62,"address":"3JZq4atUahhuA9rLhXLMhhTo133J9rF97j","label":"Bitfinex-coldwallet","btc":12767.0,"pct":"0.06364%","since":"2018-11-02"},{"rank":63,"address":"3GPAWK5aUB5Ve9akvTzZgp69USjgbhFbay","label":"78163677","btc":12418.0,"pct":"0.06190%","since":"2021-04-07"},{"rank":64,"address":"bc1qkmk4v2xn29yge68fq6zh7gvfdqrvpq3v3p3y0s","label":"Bitfinex-Hack-Recovery","btc":12267.0,"pct":"0.06115%","since":"2024-02-28"},{"rank":65,"address":"bc1q7uq3u829ahn22sdlpac0h0lurq3a9yfd3ew69f","label":"","btc":11897.0,"pct":"0.05930%","since":"2024-11-28"},{"rank":66,"address":"bc1qfv5fk2uec6symkxjkdrl7zyu8c55nzl9j2zwyppen7kl2988q86s3fujna","label":"","btc":11500.0,"pct":"0.05733%","since":"2026-07-15"},{"rank":67,"address":"162bzZT2hJfv5Gm3ZmWfWfHJjCtMD6rHhw","label":"gate.io-coldwallet","btc":11189.0,"pct":"0.05578%","since":"2022-10-19"},{"rank":68,"address":"3NWndKFmvV6cJ6ENgXVeaDTo3mBfAvr27H","label":"","btc":11166.0,"pct":"0.05566%","since":"2019-02-01"},{"rank":69,"address":"1F34duy2eeMz5mSrvFepVzy7Y1rBsnAyWC","label":"","btc":10771.0,"pct":"0.05369%","since":"2011-08-08"},{"rank":70,"address":"bc1qatjx2qc8vxz39m0qdz303z8et2pgmc74xz8km3","label":"","btc":10639.0,"pct":"0.05303%","since":"2024-12-30"},{"rank":71,"address":"bc1qxlth5har0qasqvattsjvgp80st2x402u5shuud","label":"","btc":10500.0,"pct":"0.05234%","since":"2024-06-22"},{"rank":72,"address":"12VuUfQHTGqWDvBzm8TBad1mZBm4hjGEzN","label":"","btc":10495.0,"pct":"0.05232%","since":"2023-02-21"},{"rank":73,"address":"14FEEMRhaUwMbhf2rA1cFXmS1Zuk9nc9eq","label":"","btc":10306.0,"pct":"0.05138%","since":"2026-06-02"},{"rank":74,"address":"1Q8QR5k32hexiMQnRgkJ6fmmjn5fMWhdv9","label":"Binance-Pool","btc":10217.0,"pct":"0.05093%","since":"2021-08-12"},{"rank":75,"address":"bc1qsxdxm0exqdsmnl9ejrz250xqxrxpxkgf5nhhtq","label":"","btc":10002.0,"pct":"0.04986%","since":"2021-08-14"},{"rank":76,"address":"1Ki3WTEEqTLPNsN5cGTsMkL2sJ4m5mdCXT","label":"","btc":10000.0,"pct":"0.04985%","since":"2017-10-16"},{"rank":77,"address":"1DzsfLRDfbmQM99xm59au2SrTY3YmciBSB","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":78,"address":"1GUfWdZQoo2pQ4BKHsiegxuZPnheY5ueTm","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":79,"address":"12HnxiXEeKUVjQRbMVTytsGWnzHd5LdGCt","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":80,"address":"17uULjz9moeLyjXHoKNwDRgKzf8ahY3Jia","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":81,"address":"18qNs1yBGGKR8RyErnEF5kegbNUgPfixhS","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":82,"address":"1DP3VYwN6ozHXDDaETbvNFLd86CAXfaewi","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":83,"address":"1NhJGUJu8rrTwPS4vopsdTqqcK4nAwdLwJ","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":84,"address":"1MtUMTqtdrpT6Rar5fgWoyrzAevatssej5","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":85,"address":"1MewpRkpcbFdqamPPYc1bXa9AJ189Succy","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":86,"address":"1H2MXWiSniAgg7ykdXEzPHL6oTH1ic4kP","label":"","btc":10000.0,"pct":"0.04985%","since":"2022-11-02"},{"rank":87,"address":"1CY7fykRLWXeSbKB885Kr4KjQxmDdvW923","label":"OKX","btc":10000.0,"pct":"0.04985%","since":"2020-01-18"},{"rank":88,"address":"bc1qxkhwkn623l5lg4rx9vx8cujmleaga0eg6wc7p6","label":"","btc":9800.0,"pct":"0.04885%","since":"2024-12-02"},{"rank":89,"address":"bc1q8urxlm2uye3t6nwg0y44sn32p0ynvefxpqseu4","label":"98590549","btc":9660.0,"pct":"0.04816%","since":"2023-06-02"},{"rank":90,"address":"bc1qd46j77pkp5vdxraf8tw5l6xs36dlygdx2rt9ly","label":"","btc":9500.0,"pct":"0.04736%","since":"2024-06-27"},{"rank":91,"address":"bc1qvzgrkefd8v536de2vqhx4d25e5rly7lgk3p2vp","label":"","btc":9457.0,"pct":"0.04714%","since":"2025-09-25"},{"rank":92,"address":"1P9fAFAsSLRmMu2P7wZ5CXDPRfLSWTy9N8","label":"","btc":9425.0,"pct":"0.04698%","since":"2017-10-15"},{"rank":93,"address":"1LVYbnSX6f6vE2Zn4zs2oZ4eKyBgzkqaay","label":"","btc":9375.0,"pct":"0.04674%","since":"2022-11-30"},{"rank":94,"address":"17MWdxfjPYP2PYhdy885QtihfbW181r1rn","label":"","btc":9343.0,"pct":"0.04658%","since":"2020-12-13"},{"rank":95,"address":"1HLvaTs3zR3oev9ya7Pzp3GB9Gqfg6XYJT","label":"","btc":9260.0,"pct":"0.04616%","since":"2010-03-18"},{"rank":96,"address":"33eU1zeB2S4x3p4ccSsnAChXcGJgtMrMtZ","label":"82375777","btc":9252.0,"pct":"0.04612%","since":"2019-10-07"},{"rank":97,"address":"bc1qmcdp5999hswqmdpkzk93kf788xj8sn5g7qj3gp","label":"107279212","btc":9233.0,"pct":"0.04603%","since":"2024-08-21"},{"rank":98,"address":"bc1qukqenm2t85dhdta9glqehllglxznsu4qyxn079","label":"","btc":9112.0,"pct":"0.04542%","since":"2024-07-05"},{"rank":99,"address":"bc1qffyax9rrxmqyq8xwjkzrrqwqjp3ppz5a4665f9","label":"","btc":9099.0,"pct":"0.04536%","since":"2024-07-09"},{"rank":100,"address":"bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h","label":"Binance-wallet","btc":9051.0,"pct":"0.04512%","since":"2021-10-08"}]};

/* ---------------------------------------------------------------- the map */

// World scale: the whole 21,000,000 as 50 x 42 = 2,100 tiles of 10,000 BTC.
// Exact in both directions, and it is deliberately the globe's 5,000 x 4,200
// field at 1/100 resolution, so the two views can never disagree.
const WORLD_COLS = 50;
const WORLD_ROWS = 42;
const WORLD_BTC_PER_TILE = 21000000 / (WORLD_COLS * WORLD_ROWS);   // 10,000

/**
 * Lay the top 100 out as contiguous runs over the world grid, largest first,
 * starting at tile 0. Ranges are half-open in *fractional* tiles so a 5,000 BTC
 * address still occupies half a tile rather than being rounded away.
 */
function whaleRanges(data) {
  let cum = 0;
  return (data || WHALE_DATA).addresses.map((w) => {
    const from = cum / WORLD_BTC_PER_TILE;
    cum += w.btc;
    return { ...w, from, to: cum / WORLD_BTC_PER_TILE };
  });
}

/**
 * Which whale owns a given world tile, or null for everybody else.
 *
 * Ownership is decided by the tile's CENTRE, not by any overlap. At 10,000 BTC a
 * tile, several small addresses can fall inside one tile; asking "does this
 * whale overlap this tile" then returns more than one answer and the map paints
 * whichever was checked first. A tile centre lands in exactly one contiguous
 * range, so the question has one answer — at the cost that an address smaller
 * than a tile may own no tile at all, which is the honest result: it is below
 * the resolution of the map.
 */
function whaleAtTile(index, ranges) {
  const rs = ranges || whaleRanges();
  const p = index + 0.5;
  let lo = 0, hi = rs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p < rs[mid].from) hi = mid - 1;
    else if (p >= rs[mid].to) lo = mid + 1;
    else return rs[mid];
  }
  return null;
}

/** How many of the top 100 are too small to occupy a whole tile. */
function whalesBelowTileResolution(ranges) {
  const rs = ranges || whaleRanges();
  const owned = new Set();
  for (let i = 0; i < WORLD_COLS * WORLD_ROWS; i++) {
    const w = whaleAtTile(i, rs);
    if (w) owned.add(w.rank);
  }
  return rs.length - owned.size;
}

/** Tiles the top 100 occupy in total, for the "what is left" figure. */
function whaleTileSpan(ranges) {
  const rs = ranges || whaleRanges();
  return rs.length ? rs[rs.length - 1].to : 0;
}

/** Where a holding sits on the world grid — its own tile index. */
function whaleWorldTileForBtc(btc, ranges) {
  // Your land is placed immediately after the top 100, which is honest: you are
  // not among them, and the gap is the point.
  return Math.floor(whaleTileSpan(ranges));
}

/** '34xp4v…4Twseo' — addresses are too long to show whole in a tooltip. */
function shortAddress(a) {
  return !a || a.length <= 16 ? (a || '') : `${a.slice(0, 6)}…${a.slice(-6)}`;
}

/** Exchange wallets are not one person's stack, and the UI must not imply it. */
function whaleKind(w) {
  const l = (w && w.label ? w.label : '').toLowerCase();
  if (!l) return 'unknown';
  if (/hack|recovery|seiz|silkroad|doj|government/.test(l)) return 'seized';
  if (/etf|trust|grayscale|fidelity|blackrock|ishares/.test(l)) return 'fund';
  return 'custody';
}

function whaleKindLabel(kind) {
  return { custody: 'Exchange / custody wallet', fund: 'Fund or ETF custody',
           seized: 'Seized or recovered funds', unknown: 'Unidentified holder' }[kind]
    || 'Unidentified holder';
}

function whaleUrl(address) {
  return `https://bitinfocharts.com/bitcoin/address/${address}`;
}
