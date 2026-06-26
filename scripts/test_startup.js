// Quick test: does index.js load without crashing?
try {
  process.env.PORT = '3099';
  require('../server/index.js');
  console.log('STARTUP OK');
  setTimeout(function() { process.exit(0); }, 5000);
} catch(e) {
  console.error('STARTUP FAILED:', e.message, e.stack);
  process.exit(1);
}
