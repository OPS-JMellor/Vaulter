// Builds docs/demo/index.html: the dashboard from apps-script/src running
// entirely in the browser on the sample data in Demo.html. Run from anywhere:
//   node docs/build-demo.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'apps-script', 'src');
const out  = path.join(root, 'docs', 'demo', 'index.html');

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const demo = fs.readFileSync(path.join(src, 'Demo.html'), 'utf8');

html = html
  .replace("<?!= include_('Demo') ?>", demo)
  .replace('<?= userEmail ?>', 'demo.reviewer@sampledistrict.org')
  .replace('<?= userRole ?>', 'Admin')
  .replace('<?= demoParam ?>', '1')
  .replace('<title>Vaulter</title>', '<title>Vaulter · live demo</title>')
  .replace(/Orono Public Schools/g, 'Sample District');

if (/orono/i.test(html)) throw new Error('The demo build still mentions the district.');

if (/<\?!?=/.test(html)) throw new Error('An Apps Script scriptlet was left unreplaced.');

const tail = `<script>
  // Static demo build: always sample data, and no way out of demo mode here.
  toggleDemo = function () {};
  document.getElementById('demoToggle').style.display = 'none';
  (function () {
    var banner = document.querySelector('.demo-banner .wrap');
    banner.querySelector('strong').textContent = 'Live demo';
    banner.querySelector('span:not(.sp)').textContent = 'This is the real Vaulter dashboard running on fictional sample data in your browser. Nothing here touches a district.';
    banner.querySelector('button:last-child').remove();
  })();
</script>
</body>`;
html = html.replace('</body>', tail);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('wrote ' + path.relative(root, out) + ' (' + html.length + ' bytes)');
