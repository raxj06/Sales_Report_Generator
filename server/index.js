const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());

// Helper functions
const readJSON = (filename) => {
    const filepath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filepath)) {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
    return null;
};

const writeJSON = (filename, data) => {
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
};

// ============================================
// PRODUCT MASTER ENDPOINTS
// ============================================

// Get all products
app.get('/api/products', (req, res) => {
    const products = readJSON('products.json') || {};
    res.json(products);
});

// Save all products (replace)
app.put('/api/products', (req, res) => {
    writeJSON('products.json', req.body);
    res.json({ success: true, message: 'Products saved' });
});

// Add/Update single product
app.put('/api/products/:sku', (req, res) => {
    const { sku } = req.params;
    const products = readJSON('products.json') || {};
    products[sku] = req.body;
    writeJSON('products.json', products);
    res.json({ success: true, message: `Product ${sku} saved` });
});

// Delete product
app.delete('/api/products/:sku', (req, res) => {
    const { sku } = req.params;
    const products = readJSON('products.json') || {};
    delete products[sku];
    writeJSON('products.json', products);
    res.json({ success: true, message: `Product ${sku} deleted` });
});

// ============================================
// SETTINGS ENDPOINTS
// ============================================

app.get('/api/settings', (req, res) => {
    const settings = readJSON('settings.json') || { webhookUrl: '' };
    res.json(settings);
});

app.put('/api/settings', (req, res) => {
    writeJSON('settings.json', req.body);
    res.json({ success: true, message: 'Settings saved' });
});

// ============================================
// INVOICE HISTORY ENDPOINTS
// ============================================

app.get('/api/invoices', (req, res) => {
    const invoices = readJSON('invoices.json') || [];
    res.json(invoices);
});

app.post('/api/invoices', (req, res) => {
    const invoices = readJSON('invoices.json') || [];
    const newInvoice = {
        id: Date.now(),
        ...req.body,
        created_at: new Date().toISOString()
    };
    invoices.unshift(newInvoice);
    // Keep only last 100 invoices
    if (invoices.length > 100) invoices.length = 100;
    writeJSON('invoices.json', invoices);
    res.json({ success: true, invoice: newInvoice });
});

app.get('/api/invoices/:id', (req, res) => {
    const invoices = readJSON('invoices.json') || [];
    const invoice = invoices.find(inv => inv.id === parseInt(req.params.id));
    if (invoice) {
        res.json(invoice);
    } else {
        res.status(404).json({ error: 'Invoice not found' });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`✅ Backend server running at http://localhost:${PORT}`);
    console.log(`📁 Data stored in: ${DATA_DIR}`);
});
