var http = require('http');
var body = JSON.stringify({model:'openclaw',messages:[{role:'user',content:'Return JSON: {"test":"hello"}'}],max_tokens:100});
var start = Date.now();
var req = http.request({
  hostname: '127.0.0.1', port: 18789, path: '/v1/chat/completions', method: 'POST',
  headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer 22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3'}
}, function(res) {
  console.log('elapsed:', Date.now()-start, 'status:', res.statusCode);
  var d = ''; res.on('data', function(c) { d += c; });
  res.on('end', function() { console.log('content:', d.substring(0,100)); process.exit(0); });
});
req.on('error', function(e) { console.log('err:', e.message); process.exit(0); });
req.setTimeout(25000, function() { console.log('timeout at', Date.now()-start); process.exit(0); });
req.write(body); req.end();