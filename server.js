const express = require('express');
const cors = require('cors');
const path = require('path');
const { uploadData } = require('./irysStorage');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve all static files (index.html, css, js, etc.) from the current folder
app.use(express.static(__dirname));

// The Registry Endpoint (used by your index.html to load data)
app.get('/registry', (req, res) => {
    res.sendFile(path.join(__dirname, 'registry.json'));
});

// The Upload Endpoint (used to save data to Irys)
app.post('/upload', async (req, res) => {
    try {
        const { content } = req.body;
        const txId = await uploadData(content);
        res.json({ success: true, txId });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Fontainor Protocol live at http://localhost:${PORT}`);
});
