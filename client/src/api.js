// API service - Supabase with local storage fallback
import { supabase, isSupabaseConnected } from './supabase'

const LOCAL_API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export const api = {
    // =====================================
    // PRODUCTS
    // =====================================
    async getProducts() {
        // Try Supabase first
        if (isSupabaseConnected()) {
            try {
                const { data, error } = await supabase.from('products').select('*')
                if (error) throw error
                // Convert array to object keyed by SKU
                return data.reduce((acc, p) => {
                    acc[p.sku] = {
                        name: p.name,
                        hsn_code: p.hsn_code,
                        pieces_per_box: p.pieces_per_box,
                        box_weight_kg: p.box_weight_kg,
                        box_length_cm: p.box_length_cm,
                        box_width_cm: p.box_width_cm,
                        box_height_cm: p.box_height_cm
                    }
                    return acc
                }, {})
            } catch (error) {
                console.error('Supabase getProducts error:', error)
            }
        }

        // Fallback to local backend
        try {
            const res = await fetch(`${LOCAL_API}/products`)
            if (res.ok) return await res.json()
        } catch (error) {
            console.log('Local API not available')
        }

        return null
    },

    async saveProduct(sku, product) {
        if (isSupabaseConnected()) {
            try {
                const { error } = await supabase
                    .from('products')
                    .upsert({
                        sku,
                        name: product.name,
                        hsn_code: product.hsn_code,
                        pieces_per_box: product.pieces_per_box,
                        box_weight_kg: product.box_weight_kg,
                        box_length_cm: product.box_length_cm,
                        box_width_cm: product.box_width_cm,
                        box_height_cm: product.box_height_cm,
                        updated_at: new Date().toISOString()
                    })
                if (error) throw error
                return { success: true }
            } catch (error) {
                console.error('Supabase saveProduct error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/products/${encodeURIComponent(sku)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(product)
            })
            return await res.json()
        } catch (error) {
            return null
        }
    },

    async deleteProduct(sku) {
        if (isSupabaseConnected()) {
            try {
                const { error } = await supabase.from('products').delete().eq('sku', sku)
                if (error) throw error
                return { success: true }
            } catch (error) {
                console.error('Supabase deleteProduct error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/products/${encodeURIComponent(sku)}`, {
                method: 'DELETE'
            })
            return await res.json()
        } catch (error) {
            return null
        }
    },

    // =====================================
    // SETTINGS
    // =====================================
    async getSettings() {
        if (isSupabaseConnected()) {
            try {
                const { data, error } = await supabase.from('settings').select('*')
                if (error) throw error
                // Convert array to object
                return data.reduce((acc, s) => {
                    acc[s.key] = s.value
                    return acc
                }, {})
            } catch (error) {
                console.error('Supabase getSettings error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/settings`)
            if (res.ok) return await res.json()
        } catch (error) {
            console.log('Local API not available')
        }

        return null
    },

    async saveSettings(settings) {
        if (isSupabaseConnected()) {
            try {
                // Upsert each setting
                const upserts = Object.entries(settings).map(([key, value]) => ({
                    key,
                    value: String(value),
                    updated_at: new Date().toISOString()
                }))
                const { error } = await supabase.from('settings').upsert(upserts)
                if (error) throw error
                return { success: true }
            } catch (error) {
                console.error('Supabase saveSettings error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            })
            return await res.json()
        } catch (error) {
            return null
        }
    },

    // =====================================
    // INVOICES
    // =====================================
    async getInvoices() {
        if (isSupabaseConnected()) {
            try {
                const { data, error } = await supabase
                    .from('invoices')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50)
                if (error) throw error
                return data
            } catch (error) {
                console.error('Supabase getInvoices error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/invoices`)
            if (res.ok) return await res.json()
        } catch (error) {
            console.log('Local API not available')
        }

        return []
    },

    async saveInvoice(invoice) {
        if (isSupabaseConnected()) {
            try {
                const { data, error } = await supabase
                    .from('invoices')
                    .insert({
                        invoice_number: invoice.invoice_number,
                        invoice_date: invoice.invoice_date,
                        seller_name: invoice.seller_name,
                        buyer_name: invoice.buyer_name,
                        total_boxes: invoice.total_boxes,
                        total_weight: invoice.total_weight,
                        invoice_value: invoice.invoice_value,
                        line_items: invoice.line_items,
                        extracted_data: invoice.extracted_data
                    })
                    .select()
                    .single()
                if (error) throw error
                return { success: true, invoice: data }
            } catch (error) {
                console.error('Supabase saveInvoice error:', error)
            }
        }

        // Fallback to local
        try {
            const res = await fetch(`${LOCAL_API}/invoices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invoice)
            })
            return await res.json()
        } catch (error) {
            return null
        }
    },

    // =====================================
    // STORAGE (PDFs)
    // =====================================
    async uploadInvoicePDF(file, invoiceNumber) {
        if (!isSupabaseConnected()) return null

        try {
            const fileName = `${invoiceNumber.replace(/\//g, '_')}_${Date.now()}.pdf`
            const { data, error } = await supabase.storage
                .from('invoices')
                .upload(fileName, file)

            if (error) throw error

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('invoices')
                .getPublicUrl(fileName)

            return { path: data.path, url: urlData.publicUrl }
        } catch (error) {
            console.error('Supabase uploadPDF error:', error)
            return null
        }
    },

    // =====================================
    // CONNECTION STATUS
    // =====================================
    isSupabaseConnected,

    async checkConnection() {
        if (isSupabaseConnected()) {
            try {
                const { error } = await supabase.from('settings').select('key').limit(1)
                if (!error) return 'supabase'
            } catch (e) {
                console.log('Supabase connection check failed')
            }
        }

        try {
            const res = await fetch(`${LOCAL_API}/settings`)
            if (res.ok) return 'local'
        } catch (e) {
            console.log('Local API connection check failed')
        }

        return 'none'
    }
}
