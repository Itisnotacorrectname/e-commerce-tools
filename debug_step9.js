var fs = require('fs');
var c = fs.readFileSync('skills/amazon-listing-doctor/diagnose.js', 'utf8');
var lines = c.split('\n');

// Find step9 opening
for (var i = 0; i < lines.length; i++) {
  if (lines[i].match(/async function step9/)) {
    console.log('step9 at line', i + 1);
    // Show lines 719-735 (0-indexed: 718-734)
    for (var j = i; j < i + 20; j++) {
      console.log((j + 1) + ': |' + lines[j] + '|');
    }
    break;
  }
}
