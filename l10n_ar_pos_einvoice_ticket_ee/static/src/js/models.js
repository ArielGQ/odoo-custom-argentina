/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { PosOrder } from "@point_of_sale/app/models/pos_order";

function applyAutoInvoice(order, company) {
    if (!order || !company?.auto_invoice) return;
    if (typeof order.set_to_invoice === "function") {
        try {
            order.set_to_invoice(true);
        } catch (e) {
            order.to_invoice = true;
        }
    } else {
        order.to_invoice = true;
    }
}

patch(PosStore.prototype, {
    add_new_order() {
        const order = super.add_new_order(...arguments);
        applyAutoInvoice(order, this.company);
        return order;
    },

    async _flush_orders(orders, options) {
        const result = await super._flush_orders(...arguments);

        if (!Array.isArray(result)) {
            return result;
        }

        for (const serverOrder of result) {
            let localOrder = null;

            const uuid = serverOrder?.uuid;
            if (uuid && this.models?.["pos.order"]) {
                localOrder = this.models["pos.order"].find((o) => o.uuid === uuid);
            }
            if (!localOrder) {
                localOrder = this.get_order();
            }
            if (!localOrder) continue;

            localOrder.invoice_number = serverOrder.invoice_number || "";
            localOrder.l10n_latam_document_type_id_name = serverOrder.l10n_latam_document_type_id_name || "";
            localOrder.l10n_latam_document_type_id_code = serverOrder.l10n_latam_document_type_id_code || "";
            localOrder.l10n_latam_document_report_name = serverOrder.l10n_latam_document_report_name || "";
            localOrder.l10n_ar_cae = serverOrder.l10n_ar_cae || "";
            localOrder.l10n_ar_cae_due_date = serverOrder.l10n_ar_cae_due_date || "";
            localOrder.l10n_ar_qr_code_base64 = serverOrder.l10n_ar_qr_code_base64 || "";
            localOrder.terms_and_conditions = serverOrder.terms_and_conditions || "";

            localOrder.iva_taxes = Array.isArray(serverOrder.iva_taxes)
                ? serverOrder.iva_taxes.map((tax, index) => ({ ...tax, id: tax.id || `iva_tax_${index}` }))
                : [];

            localOrder.other_taxes_total =
                serverOrder.other_taxes_total !== undefined ? serverOrder.other_taxes_total : 0;

            if (serverOrder.subtotal !== undefined && serverOrder.subtotal !== null) {
                localOrder.subtotal = serverOrder.subtotal;
            }

            localOrder.detailed_taxes = Array.isArray(serverOrder.detailed_taxes)
                ? serverOrder.detailed_taxes.map((tax, index) => ({ ...tax, id: tax.id || `tax_${index}` }))
                : [];

            applyAutoInvoice(localOrder, this.company);
        }

        return result;
    },
});

patch(PosOrder.prototype, {
    setup(vals) {
        super.setup(vals);
        if (this.company?.auto_invoice && this.state === "draft") {
            applyAutoInvoice(this, this.company);
        }
    },

    set_partner(partner) {
        const res = super.set_partner(...arguments);
        if (this.company?.auto_invoice && this.state === "draft") {
            applyAutoInvoice(this, this.company);
        }
        return res;
    },

    export_for_printing() {
        const result = super.export_for_printing(...arguments);

        // 🔒 Hardening: estos objetos TIENEN que existir siempre para que el XML no explote
        result.headerData = result.headerData || {};
        result.company_extra = result.company_extra || {};
        // partner_extra puede ser null, pero lo inicializamos coherentemente
        if (result.partner_extra === undefined) {
            result.partner_extra = null;
        }

        result.headerData.pos_name = this.pos?.config?.name || "";
        result.headerData.pos_street = this.pos?.config?.street || "";
        result.headerData.date = result.date || "";

        const receiptInvoiceNumber = !!this.company?.receipt_invoice_number;
        result.headerData.receipt_invoice_number = receiptInvoiceNumber;
        result.receipt_invoice_number = receiptInvoiceNumber;

        // ------------------------------------------------------------
        // Datos extra para el recibo (Odoo 18): NO usar this.env en XML
        // ------------------------------------------------------------
        const company = this.company || this.pos?.company || null;

        // Partner del pedido actual (cubre distintos getters/props según versión/estado)
        const partner =
            (typeof this.get_partner === "function" ? this.get_partner() : null) ||
            this.partner ||
            null;

        result.company_extra = {
            gross_income_number: company?.l10n_ar_gross_income_number || "",
            afip_start_date: company?.l10n_ar_afip_start_date || "",
            responsibility_name: company?.l10n_ar_afip_responsibility_type_id?.[1] || "",
            street: company?.street || "",
            city: company?.city || "",
            state: company?.state_id?.[1] || "",
            country: company?.country_id?.[1] || "",
            vat: company?.vat || "", // ✅ CUIT
        };

        result.partner_extra = partner
            ? {
                name: partner.name || "",
                vat: partner.vat || "",
                id_type_name: partner.l10n_latam_identification_type_id?.[1] || "",
                id_type_id: partner.l10n_latam_identification_type_id?.[0] || null,
                responsibility_name: partner.l10n_ar_afip_responsibility_type_id?.[1] || "",
                street: partner.street || "",
                city: partner.city || "",
                state: partner.state_id?.[1] || "",
                country: partner.country_id?.[1] || "",
                email: partner.email || "",
                phone: partner.phone || partner.mobile || "",
            }
            : null;

        if (this.invoice_number) {
            const parts = this.invoice_number.split(" ");
            const invoice_letter = parts?.[0]?.substring(3, 4) || "";
            const invoice_number = parts?.[1] || "";

            result.headerData.invoice_number = invoice_number;
            result.headerData.invoice_letter = invoice_letter;
            result.invoice_letter = invoice_letter;

            result.headerData.l10n_latam_document_type_id_code = this.l10n_latam_document_type_id_code || "";
            result.headerData.l10n_latam_document_name = this.l10n_latam_document_type_id_name || "";
            result.headerData.l10n_latam_document_report_name = this.l10n_latam_document_report_name || "";

            result.l10n_latam_document_report_name = this.l10n_latam_document_report_name || "";
            result.l10n_ar_cae = this.l10n_ar_cae || "";
            result.l10n_ar_cae_due_date = this.l10n_ar_cae_due_date || "";
            result.l10n_ar_qr_code_base64 = this.l10n_ar_qr_code_base64 || "";
            result.terms_and_conditions = this.terms_and_conditions || "";

            result.iva_taxes = Array.isArray(this.iva_taxes)
                ? this.iva_taxes.map((tax, index) => ({ ...tax, id: tax.id || `iva_tax_${index}` }))
                : [];

            result.other_taxes_total =
                this.other_taxes_total !== undefined ? this.other_taxes_total : 0;

            result.subtotal =
                this.subtotal !== undefined && this.subtotal !== null ? this.subtotal : 0;

            result.detailed_taxes = Array.isArray(this.detailed_taxes)
                ? this.detailed_taxes.map((tax, index) => ({ ...tax, id: tax.id || `tax_${index}` }))
                : [];
        }

        if (result.total_with_tax === undefined || result.total_with_tax === null) {
            result.total_with_tax = 0;
        }

        return result;
    },
});
