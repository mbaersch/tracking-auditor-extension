// Synthetic demo capture for screenshot generation. The structures are real
// hits (atomkraftwerke24.de, the playground that fires no tracking without Tag
// Assistant — so the data is safe to fake), trimmed and with German product
// names swapped to English so the stream matches the extension's English UI.
//
// Shape mirrors what chrome.devtools.network.onRequestFinished hands us: a HAR
// entry with { request: { url, method, postData }, startedDateTime }. The
// screenshot script replays these through the panel's real onRequest pipeline,
// so the cards render exactly as they would live — parsers included.

const PIXEL = 'C1234567890';
const T0 = '2026-06-29T17:47:07.000Z';   // fixed timestamps → deterministic shots

// TikTok posts a JSON body; build it as an object and stringify on the way out.
const tiktokPageview = JSON.stringify({
  event: 'Pageview', event_id: '', message_id: 'messageId-demo-pv',
  is_onsite: false, timestamp: T0,
  context: {
    ad: { sdk_env: 'external', jsb_status: 2 }, device: { platform: 'pc' }, user: {},
    pixel: { code: PIXEL, runtime: '1' },
    page: { url: 'https://atomkraftwerke24.de/ectest.html', referrer: 'https://tagassistant.google.com/' },
    library: { name: 'pixel.js', version: 'legacy-2.2.1' },
  },
  properties: {},
});

const tiktokAddToCart = JSON.stringify({
  event: 'AddToCart', event_id: 'ID1', message_id: 'messageId-demo-atc',
  is_onsite: false, timestamp: '2026-06-29T17:52:13.000Z',
  context: {
    user: {
      email: '8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa',
      phone_number: '860e1f38de021b232b96ab7a01bd906d0275f7f2a7ee331ebbcf890e8aec0c71',
      external_id: '123456',
    },
    pixel: { code: PIXEL, runtime: '1' },
    page: { url: 'https://atomkraftwerke24.de/shop/', referrer: 'https://atomkraftwerke24.de/' },
    library: { name: 'pixel.js', version: 'legacy-2.2.1' },
  },
  properties: {
    gtm_version: '0_2_02:14', event_trigger_source: 'GoogleTagManagerClient', currency: 'EUR', value: '99.95',
    contents: [
      { content_id: 119, content_name: 'Fuel Rods (6-pack)', brand: 'Accessories', content_category: 'Accessories', price: 99.95, quantity: 1, content_type: 'product' },
      { content_id: 33, content_name: 'Power Plant (small)', brand: 'Power Plants', content_category: 'Power Plants', price: 11000000.42, quantity: 1, content_type: 'product' },
      { content_id: 38, content_name: 'Power Plant (large)', brand: 'Power Plants', content_category: 'Power Plants', price: 123456789.99, quantity: 1, content_type: 'product' },
    ],
  },
});

// HubSpot Collected Forms submit — HubSpot scraping a filled form and shipping it
// in cleartext. Fake contact data (demo@example.com), so it is safe to show; it
// makes the top card a HubSpot form whose PII block reads "not hashed".
const hubspotForm = JSON.stringify({
  contactFields: { email: 'demo@example.com', firstName: 'Demo User', phone: '5550123' },
  formSelectorId: '#contact-form',
  formValues: { Message: 'Please call me back', Newsletter: 'Checked', Privacy: 'Checked' },
  pageTitle: 'Shop', pageUrl: 'https://atomkraftwerke24.de/shop/',
  portalId: 99999999, type: 'SCRAPED', utk: 'demo1234visitortoken',
  version: 'collected-forms-embed-js-static-1.4883', collectedFormId: 'contact-form',
});

// Each block is one page load. requests[] are replayed in order.
export const DEMO_BLOCKS = [
  {
    navUrl: 'https://atomkraftwerke24.de/ectest.html',
    navTime: Date.parse(T0),
    requests: [
      // GA4 page_view
      { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-DEMO12345&en=page_view&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&dt=Enhanced%20Conversions%20Test%20Page&_p=1782761000&gcs=G111&gcd=13r3r3r2r5l1' },
      // Meta PageView
      { url: 'https://www.facebook.com/tr/?id=1402533720264604&ev=PageView&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html' },
      // Bing UET pageLoad
      { url: 'https://bat.bing.com/action/0?ti=111111111111&tm=gtm002&Ver=2&mid=efaaf29c-46db-49ce-9945-7bfc2a75fb45&bo=3&msclkid=N&uach=pv%3D19.0.0&pi=918639831&lg=en-US&sw=1920&sh=1080&sc=32&tl=Enhanced%20Conversions%20Test%20Page&p=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&r=https%3A%2F%2Ftagassistant.google.com%2F&lt=1323&evt=pageLoad&sv=2&asc=G&cdb=AQAS&rn=967217' },
      // Pinterest init
      { url: 'https://ct.pinterest.com/v3/?tid=2612345678901&pd=%7B%22np%22%3A%22gtm%22%2C%22em%22%3A%22e5c8e5ed5d033ebd4c707cc0f991a9940ba2e330483064eda4d068223fbefcab%22%7D&event=init&ad=%7B%22loc%22%3A%22https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%22%2C%22ref%22%3A%22https%3A%2F%2Ftagassistant.google.com%2F%22%2C%22is_eu%22%3Atrue%7D&cb=1782756170450' },
      // Google Ads measurement page_view (ccm/collect, tid=AW-)
      { url: 'https://www.google.com/ccm/collect?rcb=18&frm=0&auid=1235240376.1778240583&dt=Enhanced%20Conversions%20Test%20Page&en=page_view&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&dr=tagassistant.google.com&rnd=294733418.1782761414&navt=r&npa=0&gtm=45Pe66p0v9210171140&gcs=G111&gcd=13r3r3r2r5l1&dma=1&tids=AW-1071635065&tid=AW-1071635065&fmt=8' },
      // TikTok Pageview (POST, JSON body)
      { url: 'https://analytics.tiktok.com/api/v2/pixel', method: 'POST', postData: { text: tiktokPageview } },
      // LinkedIn Insight Tag page view (px collect beacon)
      { url: 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1782761000&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&tm=gtmv2' },
      // HubSpot page view (__ptq.gif)
      { url: 'https://track-eu1.hubspot.com/__ptq.gif?a=99999999&v=1.1&pu=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&t=Enhanced%20Conversions%20Test%20Page&vi=demo1234visitortoken&cts=1782761000&sd=1920x1080&cd=24-bit&cs=UTF-8&ln=en-US&u=99999999.demo1234visitortoken&b=99999999.1&cc=15' },
    ],
  },
  {
    navUrl: 'https://atomkraftwerke24.de/shop/',
    navTime: Date.parse('2026-06-29T17:52:10.000Z'),
    requests: [
      // GA4 purchase
      { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-DEMO12345&en=purchase&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&dt=Shop&epn.value=99.95&ep.currency=EUR&ep.transaction_id=ORD-1024&gcs=G111&gcd=13r3r3r2r5l1' },
      // Meta Purchase
      { url: 'https://www.facebook.com/tr/?id=1402533720264604&ev=Purchase&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&cd%5Bvalue%5D=99.95&cd%5Bcurrency%5D=EUR' },
      // Bing UET purchase
      { url: 'https://bat.bing.com/action/0?ti=111111111111&tm=gtm002&Ver=2&mid=efaaf29c-46db-49ce-9945-7bfc2a75fb45&bo=6&msclkid=N&prodid=42&pagetype=purchase&ecomm_totalvalue=99.95&ecomm_category=Accessories&tpp=1&ea=purchase&gv=99.95&en=Y&p=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&sw=1920&sh=1080&sc=32&evt=custom&asc=G&cdb=AQAS&rn=957294' },
      // Pinterest add to cart
      { url: 'https://ct.pinterest.com/v3/?event=addtocart&ed=%7B%22np%22%3A%22gtm%22%2C%22order_id%22%3A%22ORD-1024%22%2C%22order_quantity%22%3A%221%22%2C%22value%22%3A99.95%2C%22currency%22%3A%22EUR%22%2C%22line_items%22%3A%5B%7B%22product_id%22%3A%22119%22%2C%22product_category%22%3A%22Accessories%22%7D%5D%7D&tid=2612345678901&pd=%7B%22np%22%3A%22gtm%22%2C%22em%22%3A%22e5c8e5ed5d033ebd4c707cc0f991a9940ba2e330483064eda4d068223fbefcab%22%7D&cb=1782756225395&ad=%7B%22loc%22%3A%22https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F%22%2C%22is_eu%22%3Atrue%7D' },
      // Google Ads measurement add_to_cart
      { url: 'https://www.google.com/ccm/collect?rcb=18&frm=0&ae=g&auid=1235240376.1778240583&dt=Shop&en=add_to_cart&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&rnd=294733418.1782761414&navt=r&npa=0&epn.value=99.95&_tu=CA&gtm=45Pe66p0v9210171140&gcs=G111&gcd=13r3r3r2r5l1&dma=1&tids=AW-1071635065&tid=AW-1071635065&fmt=8' },
      // TikTok AddToCart (POST, JSON body)
      { url: 'https://analytics.tiktok.com/api/v2/pixel', method: 'POST', postData: { text: tiktokAddToCart } },
      // LinkedIn Insight Tag conversion (px collect beacon, conversionId set)
      { url: 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1782761414&conversionId=111111111111&url=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&tm=gtmv2' },
      // HubSpot Collected Forms submit (cleartext contactFields) — kept last so it
      // is the newest, top card; 02-event-detail then expands its PII block.
      { url: 'https://forms-eu1.hscollectedforms.net/collected-forms/submit/form', method: 'POST', postData: { text: hubspotForm } },
    ],
  },
];
