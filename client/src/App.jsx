import { useState, useCallback, useEffect } from 'react'
import { Upload, FileText, Package, Settings, Download, Check, X, Clock } from 'lucide-react'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { api } from './api'
import productMasterData from '../product_master.json'
import './App.css'


function App() {
  const [activeTab, setActiveTab] = useState('upload')
  const [extractedData, setExtractedData] = useState(null)
  const [processedItems, setProcessedItems] = useState([])
  const [productMaster, setProductMaster] = useState({})
  const [webhookUrl, setWebhookUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [backendConnected, setBackendConnected] = useState(false)
  const [invoiceHistory, setInvoiceHistory] = useState([])

  // Product Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingSku, setEditingSku] = useState(null)
  const [formData, setFormData] = useState({
    sku: '', name: '', pieces_per_box: 48, box_weight_kg: 5,
    box_length_cm: 30, box_width_cm: 25, box_height_cm: 20
  })

  // Load data from backend on mount
  useEffect(() => {
    const loadData = async () => {
      // Check connection type
      const connectionType = await api.checkConnection()
      if (connectionType === 'supabase') {
        setBackendConnected('supabase')
      } else if (connectionType === 'local') {
        setBackendConnected('local')
      } else {
        setBackendConnected(false)
      }

      // Load products
      const products = await api.getProducts()
      if (products && Object.keys(products).length > 0) {
        setProductMaster(products)
      } else {
        // Fallback to localStorage
        const saved = localStorage.getItem('productMaster')
        setProductMaster(saved ? JSON.parse(saved) : (productMasterData.products || {}))
      }

      // Load settings
      const settings = await api.getSettings()
      if (settings?.webhookUrl) {
        setWebhookUrl(settings.webhookUrl)
      } else {
        setWebhookUrl(localStorage.getItem('webhookUrl') || '')
      }
      // Load invoice history
      const history = await api.getInvoices()
      if (history && history.length > 0) {
        setInvoiceHistory(history)
      } else {
        const savedHistory = localStorage.getItem('invoiceHistory')
        setInvoiceHistory(savedHistory ? JSON.parse(savedHistory) : [])
      }
    }
    loadData()
  }, [])

  const defaultBoxConfig = {
    pieces_per_box: 48,
    box_weight_kg: 5,
    box_length_cm: 30,
    box_width_cm: 25,
    box_height_cm: 20
  }

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Product CRUD functions
  const openProductModal = (sku = null, product = null) => {
    if (sku && product) {
      setEditingSku(sku)
      setFormData({ sku, ...product })
    } else {
      setEditingSku(null)
      setFormData({
        sku: '', name: '', pieces_per_box: 48, box_weight_kg: 5,
        box_length_cm: 30, box_width_cm: 25, box_height_cm: 20
      })
    }
    setShowModal(true)
  }

  const saveProduct = async () => {
    if (!formData.sku) {
      showToast('SKU is required', 'error')
      return
    }
    const productData = {
      name: formData.name,
      pieces_per_box: formData.pieces_per_box,
      box_weight_kg: formData.box_weight_kg,
      box_length_cm: formData.box_length_cm,
      box_width_cm: formData.box_width_cm,
      box_height_cm: formData.box_height_cm
    }

    const updated = { ...productMaster, [formData.sku]: productData }
    setProductMaster(updated)

    // Save to backend if connected, else localStorage
    if (backendConnected) {
      await api.saveProduct(formData.sku, productData)
    } else {
      localStorage.setItem('productMaster', JSON.stringify(updated))
    }

    setShowModal(false)
    showToast(editingSku ? 'Product updated!' : 'Product added!')
  }

  const deleteProduct = async (sku) => {
    if (!confirm(`Delete product ${sku}?`)) return
    const updated = { ...productMaster }
    delete updated[sku]
    setProductMaster(updated)

    // Delete from backend if connected, else localStorage
    if (backendConnected) {
      await api.deleteProduct(sku)
    } else {
      localStorage.setItem('productMaster', JSON.stringify(updated))
    }

    showToast('Product deleted!')
  }

  const handleFileUpload = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      showToast('Please upload a PDF file', 'error')
      return
    }

    if (!webhookUrl) {
      showToast('Please configure webhook URL in Settings first', 'error')
      return
    }

    setIsLoading(true)

    try {
      // Check if we need to use proxy (HTTPS site calling HTTP webhook)
      const isHttpsPage = window.location.protocol === 'https:'
      const isHttpWebhook = webhookUrl.startsWith('http://')

      if (isHttpsPage && isHttpWebhook) {
        // Use proxy - convert file to base64
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = reader.result.split(',')[1]
          const proxyUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
          const response = await fetch(`${proxyUrl}/webhook/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhookUrl, file: base64 })
          })
          if (!response.ok) throw new Error('Upload failed')
          const data = await response.json()
          processData(Array.isArray(data) ? data[0] : data)
          setIsLoading(false)
        }
        reader.onerror = () => {
          showToast('Failed to read file', 'error')
          setIsLoading(false)
        }
        reader.readAsDataURL(file)
        return
      }

      // Direct call for HTTPS webhooks or local development
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(webhookUrl, { method: 'POST', body: formData })
      if (!response.ok) throw new Error('Upload failed')
      const data = await response.json()
      processData(Array.isArray(data) ? data[0] : data)
    } catch (error) {
      showToast('Failed to process invoice. Check webhook URL.', 'error')
    }

    setIsLoading(false)
  }, [webhookUrl])

  // Normalize SKU - fix Greek characters that OCR sometimes produces
  const normalizeSku = (sku) => {
    if (!sku) return ''
    const greekToEnglish = {
      'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I',
      'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T',
      'Υ': 'Y', 'Χ': 'X'
    }
    let normalized = sku.toUpperCase()
    for (const [greek, english] of Object.entries(greekToEnglish)) {
      normalized = normalized.replace(new RegExp(greek, 'g'), english)
    }
    return normalized
  }

  const processData = (data) => {
    console.log('Received data from n8n:', data)
    console.log('Line items count:', data.line_items?.length)
    setExtractedData(data)
    recalculateItems(data.line_items)
  }

  const recalculateItems = (lineItems = null) => {
    const sourceItems = lineItems || extractedData?.line_items || []
    console.log('Processing items:', sourceItems.length)

    const items = sourceItems.map(item => {
      const normalizedSku = normalizeSku(item.sku)
      // Try exact match first, then normalized match
      let config = productMaster[item.sku]
      let matchType = 'exact'

      if (!config) {
        config = productMaster[normalizedSku]
        matchType = 'normalized'
      }

      if (!config) {
        const found = Object.entries(productMaster).find(([key]) => normalizeSku(key) === normalizedSku)
        if (found) {
          config = found[1]
          matchType = 'fuzzy'
        }
      }

      if (!config) {
        config = defaultBoxConfig
        matchType = 'default'
        console.log(`SKU not found in Product Master: "${item.sku}" (normalized: "${normalizedSku}")`)
      } else {
        console.log(`SKU matched (${matchType}): "${item.sku}"`)
      }

      const piecesPerBox = config.pieces_per_box || defaultBoxConfig.pieces_per_box
      const boxWeight = config.box_weight_kg || defaultBoxConfig.box_weight_kg
      const numBoxes = Math.ceil(item.quantity / piecesPerBox)
      return {
        ...item,
        pieces_per_box: piecesPerBox,
        box_weight_kg: boxWeight,
        box_dimensions: `${config.box_length_cm || defaultBoxConfig.box_length_cm}×${config.box_width_cm || defaultBoxConfig.box_width_cm}×${config.box_height_cm || defaultBoxConfig.box_height_cm}`,
        num_boxes: numBoxes,
        total_weight: numBoxes * boxWeight
      }
    })

    console.log('Processed items count:', items.length)
    setProcessedItems(items)
    if (!lineItems) showToast('Recalculated with updated Product Master!')
    else showToast('Invoice extracted successfully!')
  }



  const totals = processedItems.reduce((acc, item) => ({
    quantity: acc.quantity + item.quantity,
    boxes: acc.boxes + item.num_boxes,
    weight: acc.weight + item.total_weight,
    value: acc.value + item.taxable_value
  }), { quantity: 0, boxes: 0, weight: 0, value: 0 })

  const generateCSV = () => {
    if (!extractedData) return
    const headers = ['#', 'SKU', 'Description', 'Qty', 'Pcs/Box', 'Boxes', 'Box Wt (kg)', 'Dimensions', 'Total Wt (kg)', 'Value (Rs)']
    const rows = processedItems.map((item, i) => [
      i + 1,
      item.sku,
      `"${item.description?.replace(/"/g, '""') || ''}"`,
      item.quantity,
      item.pieces_per_box,
      item.num_boxes,
      item.box_weight_kg,
      item.box_dimensions?.replace(/×/g, 'x') || '',  // Replace × with x for CSV compatibility
      item.total_weight.toFixed(1),
      item.taxable_value.toFixed(2)
    ])
    rows.push(['', '', 'TOTAL', totals.quantity, '', totals.boxes, '', '', totals.weight.toFixed(1), totals.value.toFixed(2)])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    // Add UTF-8 BOM for Excel compatibility
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Report_${extractedData.invoice.number.replace(/\//g, '_')}.csv`
    a.click()
    showToast('CSV downloaded!')
  }

  const generateExcel = () => {
    if (!extractedData) return
    const wb = XLSX.utils.book_new()

    // Single clean sheet with all data
    const sheetData = [
      // Header
      ['SHIPPING REPORT'],
      [''],
      // Invoice Info
      ['Invoice Number:', extractedData.invoice.number, '', 'Invoice Date:', extractedData.invoice.date],
      [''],
      // Seller & Buyer
      ['FROM:', extractedData.seller.name],
      ['GSTIN:', extractedData.seller.gstin],
      [''],
      ['TO:', extractedData.buyer.name],
      ['GSTIN:', extractedData.buyer.gstin],
      [''],
      // Summary Totals
      ['SUMMARY'],
      ['Total Pieces:', totals.quantity, '', 'Total Boxes:', totals.boxes],
      ['Total Weight:', `${totals.weight.toFixed(1)} kg`, '', 'Invoice Value:', `₹${extractedData.totals?.invoice_value || totals.value.toFixed(2)}`],
      [''],
      // Items Table Header
      ['#', 'SKU', 'Description', 'Quantity', 'Pcs/Box', 'Boxes', 'Box Wt (kg)', 'Dimensions', 'Total Wt (kg)', 'Value (₹)'],
    ]

    // Items rows
    processedItems.forEach((item, i) => {
      sheetData.push([
        i + 1,
        item.sku,
        item.description,
        item.quantity,
        item.pieces_per_box,
        item.num_boxes,
        item.box_weight_kg,
        item.box_dimensions,
        item.total_weight.toFixed(1),
        item.taxable_value.toFixed(2)
      ])
    })

    // Totals row
    sheetData.push(['', '', 'TOTAL', totals.quantity, '', totals.boxes, '', '', totals.weight.toFixed(1), totals.value.toFixed(2)])

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 4 },   // #
      { wch: 15 },  // SKU
      { wch: 35 },  // Description
      { wch: 10 },  // Quantity
      { wch: 10 },  // Pcs/Box
      { wch: 8 },   // Boxes
      { wch: 12 },  // Box Wt
      { wch: 18 },  // Dimensions
      { wch: 12 },  // Total Wt
      { wch: 12 }   // Value
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Shipping Report')
    XLSX.writeFile(wb, `Report_${extractedData.invoice.number.replace(/\//g, '_')}.xlsx`)
    showToast('Excel downloaded!')
  }

  const generatePDF = () => {
    if (!extractedData) return
    const doc = new jsPDF()

    doc.setFontSize(16)
    doc.text('SHIPPING REPORT', 105, 15, { align: 'center' })
    doc.setFontSize(10)
    doc.text(`Invoice: ${extractedData.invoice.number} | Date: ${extractedData.invoice.date}`, 105, 22, { align: 'center' })

    doc.setFontSize(9)
    doc.text(`From: ${extractedData.seller.name}`, 14, 32)
    doc.text(`To: ${extractedData.buyer.name}`, 14, 38)

    doc.setFillColor(245, 245, 245)
    doc.rect(14, 44, 182, 10, 'F')
    doc.setFontSize(10)
    doc.text(`Total Boxes: ${totals.boxes}    Total Weight: ${totals.weight.toFixed(1)} kg    Total Pieces: ${totals.quantity}`, 20, 50)

    autoTable(doc, {
      startY: 58,
      head: [['#', 'SKU', 'Description', 'Qty', 'Pcs/Box', 'Boxes', 'Box Wt', 'Total Wt']],
      body: processedItems.map((item, i) => [i + 1, item.sku, item.description.substring(0, 30), item.quantity, item.pieces_per_box, item.num_boxes, item.box_weight_kg, item.total_weight.toFixed(1)]),
      foot: [['', '', 'TOTAL', totals.quantity, '', totals.boxes, '', totals.weight.toFixed(1)]],
      theme: 'grid',
      headStyles: { fillColor: [60, 60, 60] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
      styles: { fontSize: 8 }
    })

    doc.save(`Report_${extractedData.invoice.number.replace(/\//g, '_')}.pdf`)
    saveToHistory()
    showToast('PDF downloaded!')
  }

  const saveToHistory = async () => {
    if (!extractedData) return

    const historyEntry = {
      id: Date.now(),
      invoice_number: extractedData.invoice.number,
      invoice_date: extractedData.invoice.date,
      seller_name: extractedData.seller.name,
      buyer_name: extractedData.buyer.name,
      total_boxes: totals.boxes,
      total_weight: totals.weight,
      invoice_value: extractedData.totals.invoice_value,
      line_items: processedItems,
      extracted_data: extractedData,
      created_at: new Date().toISOString()
    }

    // Check if already exists
    if (invoiceHistory.some(h => h.invoice_number === historyEntry.invoice_number)) {
      return // Already in history
    }

    const newHistory = [historyEntry, ...invoiceHistory].slice(0, 50) // Keep last 50
    setInvoiceHistory(newHistory)

    if (backendConnected) {
      console.log('Saving invoice to Supabase...', historyEntry.invoice_number)
      const result = await api.saveInvoice(historyEntry)
      console.log('Supabase save result:', result)
      if (!result?.success) {
        console.error('Failed to save to Supabase, using localStorage fallback')
        localStorage.setItem('invoiceHistory', JSON.stringify(newHistory))
      }
    } else {
      console.log('Saving invoice to localStorage...')
      localStorage.setItem('invoiceHistory', JSON.stringify(newHistory))
    }
  }

  const loadFromHistory = (entry) => {
    setExtractedData(entry.extracted_data)
    setProcessedItems(entry.line_items)
    setActiveTab('upload')
    showToast(`Loaded invoice ${entry.invoice_number}`)
  }

  const exportHistoryCSV = (entry) => {
    const items = entry.line_items || []
    const headers = ['#', 'SKU', 'Description', 'Qty', 'Pcs/Box', 'Boxes', 'Box Wt (kg)', 'Total Wt (kg)']
    const rows = items.map((item, i) => [
      i + 1,
      item.sku,
      `"${item.description?.replace(/"/g, '""') || ''}"`,
      item.quantity,
      item.pieces_per_box,
      item.num_boxes,
      item.box_weight_kg,
      item.total_weight?.toFixed(1)
    ])

    const totals = items.reduce((acc, item) => ({
      qty: acc.qty + (item.quantity || 0),
      boxes: acc.boxes + (item.num_boxes || 0),
      weight: acc.weight + (item.total_weight || 0)
    }), { qty: 0, boxes: 0, weight: 0 })

    rows.push(['', '', 'TOTAL', totals.qty, '', totals.boxes, '', totals.weight.toFixed(1)])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    // Add UTF-8 BOM for Excel compatibility
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Report_${entry.invoice_number?.replace(/\//g, '_')}.csv`
    a.click()
    showToast('CSV downloaded!')
  }

  const exportHistoryExcel = (entry) => {
    const data = entry.extracted_data || {}
    const items = entry.line_items || []
    const wb = XLSX.utils.book_new()

    // Calculate totals
    const totals = items.reduce((acc, item) => ({
      qty: acc.qty + (item.quantity || 0),
      boxes: acc.boxes + (item.num_boxes || 0),
      weight: acc.weight + (item.total_weight || 0),
      value: acc.value + (item.taxable_value || 0)
    }), { qty: 0, boxes: 0, weight: 0, value: 0 })

    // Single clean sheet with all data
    const sheetData = [
      // Header
      ['SHIPPING REPORT'],
      [''],
      // Invoice Info
      ['Invoice Number:', entry.invoice_number, '', 'Invoice Date:', entry.invoice_date],
      [''],
      // Seller & Buyer
      ['FROM:', entry.seller_name || data.seller?.name],
      ['GSTIN:', data.seller?.gstin || ''],
      [''],
      ['TO:', entry.buyer_name || data.buyer?.name],
      ['GSTIN:', data.buyer?.gstin || ''],
      [''],
      // Summary Totals
      ['SUMMARY'],
      ['Total Pieces:', totals.qty, '', 'Total Boxes:', totals.boxes],
      ['Total Weight:', `${totals.weight.toFixed(1)} kg`, '', 'Invoice Value:', `₹${entry.invoice_value || data.totals?.invoice_value || totals.value.toFixed(2)}`],
      [''],
      // Items Table Header
      ['#', 'SKU', 'Description', 'Quantity', 'Pcs/Box', 'Boxes', 'Box Wt (kg)', 'Dimensions', 'Total Wt (kg)', 'Value (₹)'],
    ]

    // Items rows
    items.forEach((item, i) => {
      sheetData.push([
        i + 1,
        item.sku,
        item.description,
        item.quantity,
        item.pieces_per_box,
        item.num_boxes,
        item.box_weight_kg,
        item.box_dimensions || '',
        item.total_weight?.toFixed(1),
        item.taxable_value?.toFixed(2)
      ])
    })

    // Totals row
    sheetData.push(['', '', 'TOTAL', totals.qty, '', totals.boxes, '', '', totals.weight.toFixed(1), totals.value.toFixed(2)])

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 4 },   // #
      { wch: 15 },  // SKU
      { wch: 35 },  // Description
      { wch: 10 },  // Quantity
      { wch: 10 },  // Pcs/Box
      { wch: 8 },   // Boxes
      { wch: 12 },  // Box Wt
      { wch: 18 },  // Dimensions
      { wch: 12 },  // Total Wt
      { wch: 12 }   // Value
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Shipping Report')
    XLSX.writeFile(wb, `Report_${entry.invoice_number?.replace(/\//g, '_')}.xlsx`)
    showToast('Excel downloaded!')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const formatNumber = (num) => new Intl.NumberFormat('en-IN').format(num)

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <Package size={24} />
          <span>Joyspoon</span>
        </div>
        <nav>
          <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => setActiveTab('upload')}>
            <Upload size={18} /> Upload Invoice
          </button>
          <button className={activeTab === 'products' ? 'active' : ''} onClick={() => setActiveTab('products')}>
            <FileText size={18} /> Product Master
          </button>
          <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
            <Clock size={18} /> History
          </button>
          <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
            <Settings size={18} /> Settings
          </button>
        </nav>
      </aside>

      {/* Main */}
      <main className="main">
        <header>
          <h1>{activeTab === 'upload' ? 'Invoice Report Generator' : activeTab === 'products' ? 'Product Master' : activeTab === 'history' ? 'Report History' : 'Settings'}</h1>
        </header>

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="content">
            <div
              className={`upload-zone ${isLoading ? 'loading' : ''}`}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('fileInput').click()}
            >
              <Upload size={48} strokeWidth={1.5} />
              <h3>{isLoading ? 'Processing...' : 'Drop invoice PDF here'}</h3>
              <p>or click to browse</p>
              <input id="fileInput" type="file" accept=".pdf" hidden onChange={(e) => handleFileUpload(e.target.files[0])} />
            </div>

            {extractedData && (
              <div className="results">
                <div className="results-header">
                  <h2>Extracted Data</h2>
                  <div className="actions">
                    <button className="btn-secondary" onClick={() => recalculateItems()}>🔄 Recalculate</button>
                    <button className="btn-secondary" onClick={generateCSV}><Download size={16} /> CSV</button>
                    <button className="btn-secondary" onClick={generateExcel}><Download size={16} /> Excel</button>
                    <button className="btn-primary" onClick={generatePDF}><Download size={16} /> PDF</button>
                  </div>
                </div>

                {/* Summary Cards */}
                <div className="summary-cards">
                  <div className="card">
                    <span className="label">Invoice</span>
                    <span className="value">{extractedData.invoice.number}</span>
                  </div>
                  <div className="card">
                    <span className="label">Total Boxes</span>
                    <span className="value highlight">{totals.boxes}</span>
                  </div>
                  <div className="card">
                    <span className="label">Total Weight</span>
                    <span className="value">{totals.weight.toFixed(1)} kg</span>
                  </div>
                  <div className="card">
                    <span className="label">Invoice Value</span>
                    <span className="value">₹{formatNumber(extractedData.totals.invoice_value)}</span>
                  </div>
                </div>

                {/* Parties */}
                <div className="parties">
                  <div className="party">
                    <h4>From</h4>
                    <p className="name">{extractedData.seller.name}</p>
                    <p>GSTIN: {extractedData.seller.gstin}</p>
                  </div>
                  <div className="party">
                    <h4>To</h4>
                    <p className="name">{extractedData.buyer.name}</p>
                    <p>GSTIN: {extractedData.buyer.gstin}</p>
                  </div>
                </div>

                {/* Table */}
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>SKU</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Pcs/Box</th>
                        <th>Boxes</th>
                        <th>Box Wt</th>
                        <th>Dimensions</th>
                        <th>Total Wt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedItems.map((item, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td className="sku">{item.sku}</td>
                          <td className="desc">{item.description}</td>
                          <td>{item.quantity}</td>
                          <td>{item.pieces_per_box}</td>
                          <td className="highlight">{item.num_boxes}</td>
                          <td>{item.box_weight_kg} kg</td>
                          <td>{item.box_dimensions}</td>
                          <td>{item.total_weight.toFixed(1)} kg</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="3">Total</td>
                        <td>{totals.quantity}</td>
                        <td></td>
                        <td className="highlight">{totals.boxes}</td>
                        <td></td>
                        <td></td>
                        <td>{totals.weight.toFixed(1)} kg</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="content">
            <div className="products-header">
              <h2>Product Master</h2>
              <button className="btn-primary" onClick={() => openProductModal()}>
                + Add Product
              </button>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Pcs/Box</th>
                    <th>Box Weight</th>
                    <th>Dimensions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(productMaster).map(([sku, product]) => (
                    <tr key={sku}>
                      <td className="sku">{sku}</td>
                      <td>{product.name}</td>
                      <td>{product.pieces_per_box}</td>
                      <td>{product.box_weight_kg} kg</td>
                      <td>{product.box_length_cm}×{product.box_width_cm}×{product.box_height_cm}</td>
                      <td>
                        <div className="action-buttons">
                          <button className="btn-icon" onClick={() => openProductModal(sku, product)}>Edit</button>
                          <button className="btn-icon delete" onClick={() => deleteProduct(sku)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Product Modal */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{editingSku ? 'Edit Product' : 'Add Product'}</h3>
                <button className="btn-close" onClick={() => setShowModal(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>SKU Code</label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    disabled={!!editingSku}
                    placeholder="e.g., PROD-001"
                  />
                </div>
                <div className="form-group">
                  <label>Product Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Product description"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Pieces per Box</label>
                    <input
                      type="number"
                      value={formData.pieces_per_box}
                      onChange={(e) => setFormData({ ...formData, pieces_per_box: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Box Weight (kg)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.box_weight_kg}
                      onChange={(e) => setFormData({ ...formData, box_weight_kg: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Length (cm)</label>
                    <input
                      type="number"
                      value={formData.box_length_cm}
                      onChange={(e) => setFormData({ ...formData, box_length_cm: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Width (cm)</label>
                    <input
                      type="number"
                      value={formData.box_width_cm}
                      onChange={(e) => setFormData({ ...formData, box_width_cm: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Height (cm)</label>
                    <input
                      type="number"
                      value={formData.box_height_cm}
                      onChange={(e) => setFormData({ ...formData, box_height_cm: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveProduct}>Save Product</button>
              </div>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="content">
            {invoiceHistory.length === 0 ? (
              <div className="empty-state">
                <Clock size={48} strokeWidth={1.5} />
                <h3>No History Yet</h3>
                <p>Generated reports will appear here</p>
              </div>
            ) : (
              <div className="history-list">
                {invoiceHistory.map((entry) => (
                  <div key={entry.id} className="history-item">
                    <div className="history-info">
                      <div className="history-main">
                        <span className="invoice-number">{entry.invoice_number}</span>
                        <span className="invoice-date">{new Date(entry.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="history-details">
                        <span>To: {entry.buyer_name}</span>
                        <span>•</span>
                        <span>{entry.total_boxes} boxes</span>
                        <span>•</span>
                        <span>{entry.total_weight?.toFixed(1)} kg</span>
                        <span>•</span>
                        <span>₹{formatNumber(entry.invoice_value)}</span>
                      </div>
                    </div>
                    <div className="history-actions">
                      <button className="btn-icon" onClick={() => exportHistoryCSV(entry)} title="Download CSV">
                        CSV
                      </button>
                      <button className="btn-icon" onClick={() => exportHistoryExcel(entry)} title="Download Excel">
                        XLSX
                      </button>
                      <button className="btn-secondary" onClick={() => loadFromHistory(entry)}>
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="content">
            <div className="settings-card">
              <h3>n8n Webhook URL</h3>
              <p>Configure your n8n webhook endpoint for invoice extraction</p>
              <input
                type="url"
                placeholder="https://your-n8n.com/webhook/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <button className="btn-primary" onClick={async () => {
                if (backendConnected) {
                  await api.saveSettings({ webhookUrl })
                } else {
                  localStorage.setItem('webhookUrl', webhookUrl)
                }
                showToast('Settings saved!')
              }}>Save Settings</button>

              <div className="connection-status" style={{
                marginTop: '20px',
                padding: '12px',
                borderRadius: '8px',
                background: backendConnected === 'supabase' ? '#dbeafe' : backendConnected === 'local' ? '#ecfdf5' : '#fef3c7'
              }}>
                <strong>
                  {backendConnected === 'supabase' && '☁️ Supabase Connected'}
                  {backendConnected === 'local' && '✅ Local Backend Connected'}
                  {!backendConnected && '⚠️ Using Local Storage'}
                </strong>
                <p style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>
                  {backendConnected === 'supabase' && 'Data is being saved to Supabase cloud database.'}
                  {backendConnected === 'local' && 'Data is being saved to local server (server/data/).'}
                  {!backendConnected && 'Add Supabase credentials to .env or run: npm run server'}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <X size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default App
