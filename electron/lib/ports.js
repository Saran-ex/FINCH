const net = require('node:net');

function tryListen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      // A missing address family means nothing can bind there anyway.
      if (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL') {
        resolve(true);
        return;
      }
      resolve(false);
    });
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

// Checked on both stacks: the backend binds 127.0.0.1 while the UI server may
// bind :: / 0.0.0.0, so a port is only free when neither stack is in use.
async function isPortFree(port) {
  const [ipv4, ipv6] = await Promise.all([
    tryListen(port, '0.0.0.0'),
    tryListen(port, '::'),
  ]);
  return ipv4 && ipv6;
}

async function findFreePort(startPort, reserved = []) {
  const skip = new Set(reserved);
  for (let port = startPort; port < startPort + 64; port += 1) {
    if (skip.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found between ${startPort} and ${startPort + 63}`);
}

module.exports = { isPortFree, findFreePort };
