const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

app.listen(PORT, () => {
  console.log(`Dream Interpreter server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
