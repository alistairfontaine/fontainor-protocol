const express = require('express');
const cors = require('cors');
const { uploadData } = require('./irysStorage');
const app = express();

app.use(cors());
app.use(express.json());

// 1. Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 2. Serve the registry (connect this to your HTML)
app.get('/registry', (req, res) => {
    res.sendFile(__dirname + '/registry.json');
});

// 3. The Upload API
app.post('/upload', async (req, res) => {
    try {
        const { content } = req.body;
        const txId = await uploadData(content);
        res.json({ success: true, txId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, () => console.log('Fontainor Protocol live at http://localhost:3000'));
