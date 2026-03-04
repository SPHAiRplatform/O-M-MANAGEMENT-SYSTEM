const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8081;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

const server = http.createServer((req, res) => {
  // Remove query string and decode URL
  let filePath = decodeURIComponent(req.url.split('?')[0]);
  
  // Default to index.html
  if (filePath === '/') {
    filePath = '/index.html';
  }
  
  // Remove leading slash for path.join
  const fullPath = path.join(__dirname, filePath.substring(1));
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  // Check if file exists
  fs.access(fullPath, fs.constants.F_OK, (err) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    
    // Get file extension for MIME type
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    // Read and serve file
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 SPHAiRDigital Marketing Site Preview Server`);
  console.log(`📡 Server running at http://localhost:${PORT}`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}\n`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.log(`💡 Try one of these solutions:`);
    console.log(`   1. Stop the other server using port ${PORT}`);
    console.log(`   2. Find and kill the process: netstat -ano | findstr :${PORT}`);
    console.log(`   4. Or use a different port: PORT=8082 node server.js\n`);
    console.log(`   3. Or modify PORT in server.js to use a different port\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
