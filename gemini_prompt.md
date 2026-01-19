# Gemini OCR Prompt for Invoice Extraction

Use this prompt in your n8n Gemini node to extract invoice details.

---

## Prompt

```
You are an expert invoice data extractor. Analyze this invoice image/PDF and extract ALL information in the exact JSON structure below.

IMPORTANT RULES:
1. Extract EVERY line item from the invoice - do not skip any products
2. For numeric fields, return numbers only (no currency symbols or commas)
3. For missing/unclear fields, use null
4. SKU codes are in the first column of the line items table
5. Look for GST/Tax details carefully - they may be in a separate section

Extract and return ONLY valid JSON in this exact structure:

{
  "invoice": {
    "number": "Invoice number",
    "date": "YYYY-MM-DD format",
    "po_number": "PO/Order number if present",
    "po_date": "PO date if present",
    "eway_bill": "E-Way bill number if present",
    "irn_number": "IRN number if present"
  },
  "seller": {
    "name": "Company name",
    "address": "Full address",
    "gstin": "GST number",
    "pan": "PAN number",
    "phone": "Phone number",
    "email": "Email address"
  },
  "buyer": {
    "name": "Buyer/Customer name",
    "billing_address": "Full billing address",
    "shipping_address": "Full shipping address",
    "gstin": "Buyer GST number",
    "pan": "Buyer PAN if present",
    "contact_name": "Contact person name",
    "contact_phone": "Contact phone"
  },
  "line_items": [
    {
      "sr_no": 1,
      "sku": "Product SKU code",
      "description": "Product description",
      "hsn_code": "HSN/SAC code",
      "uom": "Unit of measurement",
      "size": "Size if mentioned",
      "quantity": 100,
      "mrp": 99.00,
      "discount_percent": 46.18,
      "billing_rate": 50.74,
      "taxable_value": 5074.00,
      "tax_rate": 5,
      "cgst_amount": 0,
      "sgst_amount": 0,
      "igst_amount": 253.70,
      "total_tax": 253.70
    }
  ],
  "tax_summary": {
    "tax_rate": 5,
    "total_quantity": 7736,
    "taxable_value": 958043.29,
    "cgst": 0,
    "sgst": 0,
    "igst": 47900.81,
    "utgst": 0,
    "total_tax": 47900.81
  },
  "totals": {
    "total_quantity": 7736,
    "total_taxable_value": 958043.29,
    "total_tax": 47900.81,
    "invoice_value": 1005944.10,
    "amount_in_words": "Amount in words as written on invoice"
  },
  "bank_details": {
    "account_name": "Account holder name",
    "account_number": "Bank account number",
    "ifsc_code": "IFSC code",
    "bank_name": "Bank name",
    "branch": "Branch name"
  },
  "additional_info": {
    "payment_terms": "Payment terms if mentioned",
    "delivery_terms": "Delivery terms if mentioned",
    "carrier_name": "Carrier/transporter name",
    "awb_number": "AWB/tracking number"
  }
}

CRITICAL: 
- Return ONLY the JSON object, no additional text or markdown
- Ensure all line items are captured
- Numeric values must be numbers, not strings
- Dates should be in YYYY-MM-DD format
```

---

## n8n Node Configuration

### For Gemini Vision Node:

1. **Model**: `gemini-1.5-pro` or `gemini-1.5-flash`
2. **Operation**: Generate Content
3. **Input Type**: Image/PDF
4. **Temperature**: 0.1 (for accuracy)
5. **Max Output Tokens**: 8192

### Response Handling:

Add a **Code Node** after Gemini to parse and validate:

```javascript
// Parse Gemini response
const response = $input.first().json;
let extractedData;

try {
  // Handle if response is wrapped in markdown code block
  let jsonStr = response.text || response.content || JSON.stringify(response);
  
  // Remove markdown code blocks if present
  jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  extractedData = JSON.parse(jsonStr);
} catch (e) {
  throw new Error('Failed to parse Gemini response: ' + e.message);
}

// Validate required fields
if (!extractedData.invoice || !extractedData.line_items) {
  throw new Error('Missing required fields in extracted data');
}

// Add extraction metadata
extractedData._metadata = {
  extracted_at: new Date().toISOString(),
  line_item_count: extractedData.line_items.length,
  total_quantity: extractedData.totals?.total_quantity || 0
};

return { json: extractedData };
```

---

## Alternative: Structured Output Prompt (Gemini 1.5 Pro)

For more reliable extraction, use Gemini's **Structured Output** feature:

```javascript
// In n8n HTTP Request node calling Gemini API directly
{
  "contents": [{
    "parts": [{
      "inline_data": {
        "mime_type": "application/pdf",
        "data": "{{$binary.data.toString('base64')}}"
      }
    }, {
      "text": "Extract all invoice data from this document."
    }]
  }],
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "object",
      "properties": {
        "invoice": {
          "type": "object",
          "properties": {
            "number": {"type": "string"},
            "date": {"type": "string"},
            "po_number": {"type": "string"}
          }
        },
        "line_items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sku": {"type": "string"},
              "description": {"type": "string"},
              "quantity": {"type": "number"},
              "taxable_value": {"type": "number"}
            }
          }
        }
      }
    }
  }
}
```

---

## Testing the Prompt

Test with your sample invoice to verify extraction accuracy:

1. Upload `Invoice SO1073 GAYATRI ENTERPRISE.pdf`
2. Expected result: 17 line items extracted
3. Total quantity should be: 7,736
4. Invoice value should be: ₹10,05,944.10
