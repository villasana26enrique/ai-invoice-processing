"""Builds the demo invoices and their ground truth: 30 supplier invoices of a fictional dental clinic.

Each supplier has its own layout (header, columns, fonts, date format, labels), some invoices are turned into
phone photos or scans, and a few are traps on purpose (a total that does not add up, a duplicate, an unknown
supplier, ...). The ground truth says what is printed on each one and what the validation should decide.

    docker build -t invoice-demo-tools demo
    docker run --rm -v "$PWD/demo:/demo" invoice-demo-tools python /demo/generate_invoices.py [--as-of 2026-10-29]

Output: demo/build/invoices/<file> and demo/build/ground-truth.json (in the order they should be processed).
Dates are relative to --as-of (default: today), so the invoices never become "older than a year" by themselves.
Same --as-of, same files: everything random comes from a fixed seed.
"""
import argparse
import io
import json
import random
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import fitz  # PyMuPDF
from fpdf import FPDF
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).parent
OUTPUT = ROOT / "build"
CENT = Decimal("0.01")
TAX_RATE = Decimal("0.0825")  # Austin, TX
CLINIC = ["Maple Grove Dental Studio", "Attn: Accounts Payable", "1200 Maple Grove Rd, Suite 4", "Austin, TX 78701"]

# Suppliers: the first seven are in database/migrations/V2__seed_demo_suppliers.sql (same names and tax ids)
SUPPLIERS = {
    "summit": {
        "name": "Summit Dental Supply, Inc.", "tax_id": "00-4417821", "known": True, "taxed": True,
        "address": ["4800 Industrial Pkwy", "Dallas, TX 75247", "(000) 555-0141"],
        "prefix": "SDS-", "number": 240117, "terms": "Net 30", "due_days": 30, "shipping": ["14.95", "0", "22.50"],
        "style": {"header": "band", "font": "Helvetica", "accent": (22, 78, 140), "columns": "item_code",
                  "date_format": "%m/%d/%Y", "number_label": "Invoice #", "date_label": "Invoice Date",
                  "due_label": "Due Date", "show_tax_id": True, "zebra": True},
        "catalog": [("NG-200M", "Nitrile exam gloves, medium (box of 200)", "18.40"),
                    ("NG-200L", "Nitrile exam gloves, large (box of 200)", "18.40"),
                    ("MSK-L3", "Level 3 procedure masks (box of 50)", "12.75"),
                    ("PP-MINT", "Prophy paste, mint, medium grit (200 cups)", "41.90"),
                    ("SB-500", "Saliva ejectors, clear/blue (bag of 100)", "6.85"),
                    ("BIB-500", "Patient bibs, 2-ply tissue (case of 500)", "29.99"),
                    ("CW-2", "Cotton rolls #2 medium (2,000 ct)", "11.20"),
                    ("FL-12", "Fluoride varnish 5%, mint (pack of 50)", "64.00"),
                    ("COMP-A2", "Universal composite syringe, shade A2 (4 g)", "38.50"),
                    ("ETCH-37", "Phosphoric acid etch gel 37% (4 x 5 ml)", "19.25"),
                    ("BOND-5", "Universal bonding agent (5 ml)", "72.80"),
                    ("ANES-L", "Lidocaine 2% 1:100k cartridges (box of 50)", "54.60"),
                    ("NDL-27S", "Dental needles 27G short (box of 100)", "16.40"),
                    ("STP-200", "Sterilization pouches 3.5 x 9 in (box of 200)", "9.95"),
                    ("BI-25", "Biological indicator vials (box of 25)", "47.30"),
                    ("SURF-W", "Surface disinfectant wipes (160 ct)", "8.75"),
                    ("HVE-100", "HVE tips, vented (bag of 100)", "13.60"),
                    ("AW-250", "Air/water syringe tips (bag of 250)", "21.40"),
                    ("IMP-HB", "Impression material, heavy body (2 x 50 ml)", "33.10"),
                    ("IMP-LB", "Impression material, light body (2 x 50 ml)", "33.10"),
                    ("TRAY-M", "Disposable impression trays, medium (12 ct)", "7.90"),
                    ("FLOSS-P", "Patient floss samples (box of 144)", "15.80"),
                    ("TB-SOFT", "Patient toothbrushes, soft (box of 72)", "26.40"),
                    ("GZ-2X2", "Gauze sponges 2 x 2 in (pack of 200)", "4.60"),
                    ("POL-CUP", "Prophy angles with cups (box of 100)", "23.70"),
                    ("BUR-330", "Carbide burs FG 330 (pack of 10)", "17.90"),
                    ("BUR-D", "Diamond burs, assorted (pack of 5)", "21.30"),
                    ("MATRIX", "Sectional matrix bands (pack of 50)", "28.40"),
                    ("WEDGE", "Wooden wedges, assorted (box of 100)", "6.30"),
                    ("RDAM", "Rubber dam sheets, medium (box of 36)", "14.20")],
    },
    "clearview": {
        "name": "ClearView Dental Lab LLC", "tax_id": "00-7302264", "known": True, "taxed": False, "quantities": [1, 1, 1, 2, 3],
        "address": ["210 Cypress Creek Rd", "Cedar Park, TX 78613"],
        "prefix": "CV", "number": 88310, "terms": "Net 15", "due_days": 15, "shipping": ["0"],
        "style": {"header": "left", "font": "Times", "accent": (60, 60, 60), "columns": "qty",
                  "date_format": "%B %d, %Y", "number_label": "Invoice No.", "date_label": "Date",
                  "due_label": "Payment Due", "show_tax_id": False, "zebra": False, "grid": True},
        "catalog": [("", "Zirconia crown #{tooth} - case {case}", "189.00"),
                    ("", "PFM crown #{tooth} - case {case}", "145.00"),
                    ("", "E.max veneer #{tooth} - case {case}", "210.00"),
                    ("", "Night guard, hard acrylic - case {case}", "95.00"),
                    ("", "Implant abutment, custom #{tooth} - case {case}", "265.00"),
                    ("", "Study models (pair) - case {case}", "35.00"),
                    ("", "Remake: shade adjustment #{tooth} - case {case}", "60.00")],
    },
    "pacific": {
        "name": "Pacific Coast Medical Waste", "tax_id": "00-5568190", "known": True, "taxed": False,
        "address": ["PO Box 4471", "San Antonio, TX 78216"],
        "prefix": "PCW-", "number": 1907, "terms": "Due upon receipt", "due_days": None, "shipping": ["0"],
        "style": {"header": "center", "font": "Helvetica", "accent": (34, 120, 74), "columns": "amount_only",
                  "date_format": "%Y-%m-%d", "number_label": "Statement No.", "date_label": "Statement Date",
                  "due_label": "Due", "show_tax_id": True, "zebra": False},
        "catalog": [("", "Sharps container pickup - {month}", "48.00"),
                    ("", "Regulated medical waste service - {month}", "95.00"),
                    ("", "Amalgam separator recycling - {month}", "65.00"),
                    ("", "Pharmaceutical waste disposal - {month}", "38.00"),
                    ("", "Fuel and environmental surcharge", "12.50")],
    },
    "brightpath": {
        "name": "BrightPath IT Services", "tax_id": "00-2093317", "known": True, "taxed": False,
        "address": ["901 Congress Ave, Floor 6", "Austin, TX 78701", "billing@example.com"],
        "prefix": "BP-", "number": 5521, "terms": "Net 30", "due_days": 30, "shipping": ["0"],
        "style": {"header": "boxed", "font": "Courier", "accent": (110, 50, 150), "columns": "hours",
                  "date_format": "%b %d, %Y", "number_label": "Invoice Number", "date_label": "Issued",
                  "due_label": "Due", "show_tax_id": False, "zebra": False},
        "catalog": [("", "Remote support - workstation issues", "95.00"),
                    ("", "On-site visit - network troubleshooting", "125.00"),
                    ("", "Imaging software update and testing", "110.00"),
                    ("", "Backup verification and restore test", "95.00"),
                    ("", "Firewall rule review", "125.00"),
                    ("", "New hire account setup", "85.00"),
                    ("", "Printer and scanner configuration", "85.00")],
    },
    "evergreen": {
        "name": "Evergreen Office Products", "tax_id": "00-8841056", "known": True, "taxed": True,
        "address": ["7700 Burnet Rd", "Austin, TX 78757"],
        "prefix": "EOP", "number": 30442, "terms": "Net 30", "due_days": 30, "shipping": ["9.99", "0"],
        "style": {"header": "left", "font": "Helvetica", "accent": (200, 90, 20), "columns": "item_code",
                  "date_format": "%d-%b-%Y", "number_label": "Invoice", "date_label": "Order Date",
                  "due_label": "Due Date", "show_tax_id": False, "zebra": True, "totals_left": True},
        "catalog": [("PPR-CS", "Copy paper, letter, 10 reams", "54.99"),
                    ("TNR-26A", "Laser toner cartridge 26A", "89.50"),
                    ("ENV-10", "Envelopes #10, security tint (500)", "21.75"),
                    ("LBL-30", "Address labels, 30 per sheet (100 sheets)", "18.20"),
                    ("PEN-BK", "Ballpoint pens, black (dozen)", "6.49"),
                    ("FLDR-L", "File folders, letter, 1/3 cut (100)", "17.80"),
                    ("STK-3", "Sticky notes 3 x 3 in (12 pads)", "9.30"),
                    ("BAT-AA", "AA batteries (24 pack)", "16.90"),
                    ("CLIP-L", "Binder clips, large (box of 12)", "4.10"),
                    ("RCPT", "Thermal receipt paper rolls (50)", "37.60")],
    },
    "lakeside": {
        "name": "Lakeside Uniform & Linen Co.", "tax_id": "00-6620478", "known": True, "taxed": True,
        "address": ["3315 E 5th St", "Austin, TX 78702"],
        "prefix": "LUL-", "number": 7710, "terms": "Net 20", "due_days": 20, "shipping": ["0"],
        "style": {"header": "band", "font": "Times", "accent": (130, 30, 40), "columns": "qty",
                  "date_format": "%m/%d/%y", "number_label": "Invoice No", "date_label": "Invoice Date",
                  "due_label": "Due Date", "show_tax_id": True, "zebra": False, "grid": True},
        "catalog": [("", "Scrub tops laundered", "2.25"),
                    ("", "Scrub pants laundered", "2.25"),
                    ("", "Lab coats laundered and pressed", "3.40"),
                    ("", "Patient towels (bundle of 25)", "7.80"),
                    ("", "Mop heads exchange", "4.50"),
                    ("", "Floor mat exchange 3 x 5 ft", "6.90")],
    },
    "northstar": {
        "name": "Northstar Equipment Repair", "tax_id": "00-3159902", "known": True, "taxed": True, "quantities": [1, 1, 1, 2, 3],
        "address": ["1450 W Howard Ln", "Pflugerville, TX 78660"],
        "prefix": "NER-", "number": 412, "terms": "Net 30", "due_days": 30, "shipping": ["0"],
        "style": {"header": "center", "font": "Courier", "accent": (30, 30, 30), "columns": "qty",
                  "date_format": "%m/%d/%Y", "number_label": "Work Order / Invoice", "date_label": "Date",
                  "due_label": "Due Date", "show_tax_id": False, "zebra": False, "grid": True},
        "catalog": [("", "Service call - autoclave", "145.00"),
                    ("", "Autoclave door gasket", "62.40"),
                    ("", "Handpiece turbine replacement", "189.00"),
                    ("", "Compressor maintenance kit", "118.75"),
                    ("", "Labor (per hour)", "110.00"),
                    ("", "Vacuum pump filter", "34.20"),
                    ("", "Dental chair hydraulic hose", "47.80")],
    },
    # Not in the database: every invoice from it goes to review
    "riverbend": {
        "name": "Riverbend Promotional Goods", "tax_id": None, "known": False, "taxed": True, "quantities": [1, 2, 3],
        "address": ["88 Mill St", "San Marcos, TX 78666"],
        "prefix": "RPG", "number": 1203, "terms": "Net 30", "due_days": 30, "shipping": ["18.00"],
        "style": {"header": "boxed", "font": "Helvetica", "accent": (0, 130, 140), "columns": "qty",
                  "date_format": "%B %d, %Y", "number_label": "Invoice #", "date_label": "Date",
                  "due_label": "Due Date", "show_tax_id": False, "zebra": True},
        "catalog": [("", "Kids toothbrushes with clinic logo (gross)", "86.40"),
                    ("", "Branded floss dispensers (250)", "112.50"),
                    ("", "Tote bags with logo (100)", "149.00"),
                    ("", "Appointment reminder magnets (500)", "64.00")],
    },
}

# (id, supplier, days before --as-of, lines, variant, trap). Processed in this order.
# Variants: pdf (as sent), photo (phone picture, JPEG), scan (grayscale scanner, PNG).
INVOICES = [
    ("01", "summit", 21, 6, "pdf", None),
    ("02", "summit", 48, 28, "pdf", None),            # two pages
    ("03", "summit", 9, 4, "photo", None),
    ("04", "summit", 33, 5, "pdf", "wrong_total"),
    ("05", "summit", 62, 3, "scan", None),
    ("06", "clearview", 12, 3, "pdf", None),
    ("07", "clearview", 26, 2, "pdf", None),
    ("08", "clearview", 40, 4, "photo", "line_math"),
    ("09", "clearview", 55, 1, "pdf", None),
    ("10", "pacific", 5, 3, "pdf", None),
    ("11", "pacific", 35, 4, "pdf", None),
    ("12", "pacific", 66, 3, "scan", None),
    ("13", "pacific", 400, 3, "pdf", "old_date"),
    ("14", "brightpath", 7, 4, "pdf", None),
    ("15", "brightpath", 37, 3, "pdf", None),
    ("16", "brightpath", 15, 2, "photo", None),
    ("17", "brightpath", 68, 5, "pdf", None),
    ("18", "evergreen", 4, 7, "pdf", None),
    ("19", "evergreen", 19, 5, "photo", None),
    ("20", "evergreen", 44, 4, "pdf", None),
    ("21", "evergreen", 71, 3, "scan", None),
    ("22", "lakeside", 8, 4, "pdf", None),
    ("23", "lakeside", 22, 4, "scan", "illegible_date"),
    ("24", "lakeside", 50, 3, "pdf", None),
    ("25", "northstar", 11, 3, "pdf", None),
    ("26", "northstar", 30, 2, "pdf", None),
    ("27", "northstar", 58, 3, "photo", None),
    ("28", "riverbend", 16, 4, "pdf", "unknown_supplier"),
    ("29", "summit", 21, 6, "photo", "duplicate"),     # invoice 01 again, photographed
    ("30", "lakeside", 3, 3, "photo", None),
]

# What the validation should report for each trap (none: approved automatically)
EXPECTED_ISSUES = {
    None: [], "wrong_total": ["total_mismatch"], "line_math": ["line_amount_mismatch"], "old_date": ["old_date"],
    "illegible_date": ["missing_field"], "unknown_supplier": ["unknown_supplier"], "duplicate": ["duplicate_invoice"],
}


def money(value) -> Decimal:
    return Decimal(value).quantize(CENT, ROUND_HALF_UP)


def fmt_money(value: Decimal, symbol=True) -> str:
    return ("$" if symbol else "") + f"{value:,.2f}"


def fmt_qty(value: Decimal) -> str:
    return f"{value.normalize():f}"


def build_invoice(spec, as_of: date, rng: random.Random) -> dict:
    """The invoice as printed: supplier, numbers, dates and lines (with the trap applied)."""
    inv_id, key, days_ago, n_lines, variant, trap = spec
    supplier = SUPPLIERS[key]
    invoice_date = as_of - timedelta(days=days_ago)
    columns = supplier["style"]["columns"]
    month = (invoice_date.replace(day=1) - timedelta(days=1)).strftime("%B %Y")

    lines = []
    for code, description, price in rng.sample(supplier["catalog"], min(n_lines, len(supplier["catalog"]))) \
            if n_lines <= len(supplier["catalog"]) else [rng.choice(supplier["catalog"]) for _ in range(n_lines)]:
        description = description.format(tooth=rng.randint(2, 31), case=f"{rng.randint(24, 26)}-{rng.randint(1000, 9999)}",
                                         month=month)
        if columns == "amount_only":
            quantity, unit_price = None, None
            amount = money(price)
        else:
            quantity = Decimal(rng.choice(["0.5", "1", "1.5", "2", "3"])) if columns == "hours" \
                else Decimal(rng.choice(supplier.get("quantities", [1, 1, 2, 2, 3, 4, 5, 6, 10, 12, 20, 25])))
            unit_price = Decimal(price)
            amount = money(quantity * unit_price)
        lines.append({"code": code, "description": description, "quantity": quantity, "unit_price": unit_price,
                      "amount": amount})

    if trap == "line_math":
        # The supplier typed one amount wrong; the subtotal adds up the amounts as printed
        lines[1]["amount"] += Decimal("10.00")

    subtotal = sum((line["amount"] for line in lines), Decimal(0))
    tax = money(subtotal * TAX_RATE) if supplier["taxed"] else Decimal("0.00")
    shipping = money(rng.choice(supplier["shipping"]))
    total = subtotal + tax + shipping
    if trap == "wrong_total":
        total += Decimal("10.00")

    number = f"{supplier['prefix']}{supplier['number'] + int(inv_id) * 7}"
    due = invoice_date + timedelta(days=supplier["due_days"]) if supplier["due_days"] else None
    return {"id": inv_id, "key": key, "supplier": supplier, "number": number, "invoice_date": invoice_date,
            "due_date": due, "lines": lines, "subtotal": subtotal, "tax": tax, "shipping": shipping, "total": total,
            "variant": variant, "trap": trap}


# ---------------------------------------------------------------- PDF layout

class InvoicePdf(FPDF):
    def __init__(self, invoice):
        super().__init__(unit="pt", format="letter")
        self.invoice = invoice
        self.style_ = invoice["supplier"]["style"]
        self.set_auto_page_break(False)
        self.alias_nb_pages()
        self.set_margins(48, 48, 48)
        # Fixed creation date: the same --as-of always gives the same bytes (and the same file hash)
        self.set_creation_date(datetime.combine(invoice["invoice_date"], time(9), timezone.utc))

    def footer(self):
        self.set_y(-42)
        self.set_font(self.style_["font"], size=8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"{self.invoice['supplier']['name']}  |  {self.invoice['number']}  |  Page {self.page_no()} of {{nb}}",
                  align="C")


def font(pdf, size, style=""):
    pdf.set_font(pdf.style_["font"], style, size)


def draw_header(pdf, invoice) -> float:
    """Supplier block and the INVOICE title. Returns the y where the next block starts."""
    s, supplier = pdf.style_, invoice["supplier"]
    accent, width = s["accent"], pdf.w - 96
    title = "STATEMENT" if s["number_label"].startswith("Statement") else "INVOICE"
    tax_line = [f"EIN {supplier['tax_id']}"] if s["show_tax_id"] and supplier["tax_id"] else []
    address = supplier["address"] + tax_line

    if s["header"] == "band":
        pdf.set_fill_color(*accent)
        pdf.rect(0, 0, pdf.w, 112, "F")
        pdf.set_text_color(255, 255, 255)
        pdf.set_xy(48, 28)
        font(pdf, 20, "B")
        pdf.cell(width * 0.65, 24, supplier["name"])
        font(pdf, 26, "B")
        pdf.cell(width * 0.35, 24, title, align="R")
        font(pdf, 9)
        for i, text in enumerate(address):
            pdf.set_xy(48, 56 + i * 11)
            pdf.cell(width, 11, text)
        return 136
    if s["header"] == "left":
        pdf.set_text_color(*accent)
        pdf.set_xy(48, 44)
        font(pdf, 22, "B")
        pdf.cell(width * 0.65, 26, supplier["name"])
        pdf.set_text_color(40, 40, 40)
        font(pdf, 28)
        pdf.cell(width * 0.35, 26, title.title(), align="R")
        pdf.set_text_color(100, 100, 100)
        font(pdf, 10)
        for i, text in enumerate(address):
            pdf.set_xy(48, 74 + i * 12)
            pdf.cell(width, 12, text)
        return 104 + len(address) * 12
    if s["header"] == "center":
        pdf.set_text_color(*accent)
        font(pdf, 20, "B")
        pdf.set_xy(48, 40)
        pdf.cell(width, 24, supplier["name"], align="C")
        pdf.set_text_color(70, 70, 70)
        font(pdf, 9)
        pdf.set_xy(48, 66)
        pdf.cell(width, 11, "  -  ".join(address), align="C")
        pdf.set_draw_color(*accent)
        pdf.set_line_width(1.2)
        pdf.line(48, 84, pdf.w - 48, 84)
        pdf.set_text_color(30, 30, 30)
        font(pdf, 16, "B")
        pdf.set_xy(48, 92)
        pdf.cell(width, 20, title, align="C")
        return 128
    # boxed
    pdf.set_draw_color(*accent)
    pdf.set_line_width(1.5)
    pdf.rect(48, 40, width * 0.6, 84)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(58, 48)
    font(pdf, 15, "B")
    pdf.cell(width * 0.6 - 20, 20, supplier["name"])
    font(pdf, 9)
    for i, text in enumerate(address):
        pdf.set_xy(58, 70 + i * 11)
        pdf.cell(width * 0.6 - 20, 11, text)
    pdf.set_fill_color(*accent)
    pdf.rect(48 + width * 0.65, 40, width * 0.35, 40, "F")
    pdf.set_text_color(255, 255, 255)
    font(pdf, 20, "B")
    pdf.set_xy(48 + width * 0.65, 50)
    pdf.cell(width * 0.35, 20, title, align="C")
    return 140


def draw_meta(pdf, invoice, y, smudge_date) -> float:
    """Bill-to on the left, number and dates on the right."""
    s = pdf.style_
    pdf.set_text_color(30, 30, 30)
    font(pdf, 9, "B")
    pdf.set_xy(48, y)
    pdf.cell(200, 12, "BILL TO")
    font(pdf, 10)
    for i, text in enumerate(CLINIC):
        pdf.set_xy(48, y + 14 + i * 13)
        pdf.cell(220, 13, text)

    date_text = invoice["invoice_date"].strftime(s["date_format"])
    due_text = invoice["due_date"].strftime(s["date_format"]) if invoice["due_date"] else invoice["supplier"]["terms"]
    rows = [(s["number_label"], invoice["number"]), (s["date_label"], date_text), (s["due_label"], due_text),
            ("Terms", invoice["supplier"]["terms"])]
    x_label, x_value = pdf.w - 48 - 250, pdf.w - 48 - 120
    for i, (label, value) in enumerate(rows):
        pdf.set_xy(x_label, y + i * 15)
        font(pdf, 9, "B")
        pdf.cell(130, 15, label + ":")
        pdf.set_xy(x_value, y + i * 15)
        font(pdf, 10)
        pdf.cell(120, 15, value, align="R")
        if smudge_date and label == s["date_label"]:
            # A coffee stain / ink blot right over the date: unreadable on purpose
            pdf.set_fill_color(70, 55, 40)
            for dx, dy, w, h in [(14, 1, 110, 13), (30, 0, 80, 15), (60, 2, 66, 11)]:  # only the date's row
                pdf.ellipse(x_value + dx, y + i * 15 + dy, w, h, "F")
    return y + 14 + len(CLINIC) * 13 + 22


COLUMNS = {
    "qty": [("Description", 0.56, "L"), ("Qty", 0.1, "R"), ("Unit Price", 0.17, "R"), ("Amount", 0.17, "R")],
    "item_code": [("Item #", 0.14, "L"), ("Description", 0.44, "L"), ("Qty", 0.08, "R"), ("Price", 0.16, "R"),
                  ("Total", 0.18, "R")],
    "amount_only": [("Description", 0.78, "L"), ("Amount", 0.22, "R")],
    "hours": [("Service", 0.56, "L"), ("Hours", 0.1, "R"), ("Rate", 0.17, "R"), ("Amount", 0.17, "R")],
}


def row_cells(columns, line):
    if columns == "item_code":
        return [line["code"], line["description"], fmt_qty(line["quantity"]), fmt_money(line["unit_price"], False),
                fmt_money(line["amount"])]
    if columns == "amount_only":
        return [line["description"], fmt_money(line["amount"])]
    return [line["description"], fmt_qty(line["quantity"]), fmt_money(line["unit_price"]), fmt_money(line["amount"])]


def draw_table_header(pdf, y) -> float:
    s, width = pdf.style_, pdf.w - 96
    pdf.set_fill_color(*s["accent"])
    pdf.set_text_color(255, 255, 255)
    font(pdf, 9, "B")
    pdf.set_xy(48, y)
    for title, share, align in COLUMNS[s["columns"]]:
        pdf.cell(width * share, 20, " " + title + " ", align=align, fill=True)
    return y + 20


def draw_lines(pdf, invoice, y) -> float:
    s, width = pdf.style_, pdf.w - 96
    y = draw_table_header(pdf, y)
    pdf.set_draw_color(190, 190, 190)
    pdf.set_line_width(0.5)
    for i, line in enumerate(invoice["lines"]):
        if y > pdf.h - 110:  # next page, repeating the column titles
            pdf.add_page()
            y = draw_table_header(pdf, 60)
        if s.get("zebra") and i % 2:
            pdf.set_fill_color(242, 242, 242)
            pdf.rect(48, y, width, 18, "F")
        pdf.set_text_color(30, 30, 30)
        font(pdf, 9)
        pdf.set_xy(48, y)
        for (title, share, align), text in zip(COLUMNS[s["columns"]], row_cells(s["columns"], line)):
            pdf.cell(width * share, 18, " " + text + " ", align=align, border="B" if s.get("grid") else 0)
        y += 18
    return y + 12


def draw_totals(pdf, invoice, y):
    s = pdf.style_
    if y > pdf.h - 190:
        pdf.add_page()
        y = 60
    rows = [("Subtotal", invoice["subtotal"]),
            (f"Sales Tax ({TAX_RATE * 100:.2f}%)" if invoice["supplier"]["taxed"] else "Sales Tax", invoice["tax"])]
    if invoice["shipping"] or s["columns"] == "item_code":
        rows.append(("Shipping & Handling", invoice["shipping"]))
    rows.append(("TOTAL DUE" if s["header"] != "center" else "AMOUNT DUE", invoice["total"]))
    x = 48 if s.get("totals_left") else pdf.w - 48 - 230
    for i, (label, value) in enumerate(rows):
        last = i == len(rows) - 1
        if last:
            pdf.set_fill_color(*s["accent"])
            pdf.set_text_color(255, 255, 255)
        else:
            pdf.set_text_color(30, 30, 30)
        font(pdf, 11 if last else 10, "B" if last else "")
        pdf.set_xy(x, y + i * 18 + (6 if last else 0))
        pdf.cell(130, 20 if last else 18, " " + label, fill=last)
        pdf.cell(100, 20 if last else 18, fmt_money(value) + " ", align="R", fill=last)

    note_y = y + len(rows) * 18 + 40
    pdf.set_text_color(90, 90, 90)
    font(pdf, 9)
    pdf.set_xy(48, note_y)
    pdf.multi_cell(pdf.w - 96, 12, f"Payment terms: {invoice['supplier']['terms']}. Please include the invoice number "
                                   f"with your payment. Thank you for your business!")


def render_pdf(invoice, smudge_date=False) -> bytes:
    pdf = InvoicePdf(invoice)
    pdf.add_page()
    y = draw_header(pdf, invoice)
    y = draw_meta(pdf, invoice, y, smudge_date)
    y = draw_lines(pdf, invoice, y)
    draw_totals(pdf, invoice, y)
    return bytes(pdf.output())


# ---------------------------------------------------------------- photos and scans

def first_page_image(pdf_bytes: bytes, dpi: int) -> Image.Image:
    page = fitz.open(stream=pdf_bytes, filetype="pdf")[0]
    pix = page.get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def perspective_coefficients(source, target):
    """Coefficients for Image.transform(PERSPECTIVE) mapping target corners to source corners (8x8 solve)."""
    rows, values = [], []
    for (x, y), (u, v) in zip(target, source):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values += [u, v]
    n = len(rows)
    matrix = [rows[i] + [values[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(matrix[r][col]))
        matrix[col], matrix[pivot] = matrix[pivot], matrix[col]
        for r in range(n):
            if r != col:
                factor = matrix[r][col] / matrix[col][col]
                matrix[r] = [a - factor * b for a, b in zip(matrix[r], matrix[col])]
    return [matrix[i][n] / matrix[i][i] for i in range(n)]


def photograph(pdf_bytes: bytes, rng: random.Random) -> bytes:
    """A phone picture of the printed page on a desk: tilted, in perspective, uneven light, warm tint, JPEG."""
    page = first_page_image(pdf_bytes, 130)
    w, h = page.size
    margin = int(w * 0.08)
    canvas = Image.new("RGB", (w + 2 * margin, h + 2 * margin), (92, 76, 60))  # wooden desk
    canvas.paste(page, (margin, margin))
    cw, ch = canvas.size

    # Perspective: move each corner a little
    jitter = lambda: rng.randint(-int(w * 0.035), int(w * 0.035))  # noqa: E731
    target = [(jitter(), jitter()), (cw + jitter(), jitter()), (cw + jitter(), ch + jitter()), (jitter(), ch + jitter())]
    source = [(0, 0), (cw, 0), (cw, ch), (0, ch)]
    photo = canvas.transform((cw, ch), Image.PERSPECTIVE, perspective_coefficients(source, target),
                             Image.BICUBIC, fillcolor=(80, 66, 52))
    photo = photo.rotate(rng.uniform(-4, 4), Image.BICUBIC, expand=False, fillcolor=(80, 66, 52))

    # Uneven light: a shadow falling from one side
    gradient = Image.linear_gradient("L").rotate(rng.choice([0, 90, 180, 270])).resize((cw, ch))
    shadow = gradient.point(lambda p: 150 + p * 105 // 255)
    photo = ImageChops.multiply(photo, Image.merge("RGB", [shadow] * 3))
    photo = ImageChops.multiply(photo, Image.new("RGB", photo.size, (255, 243, 222)))  # warm indoor light
    photo = photo.filter(ImageFilter.GaussianBlur(0.7))
    noise = Image.effect_noise(photo.size, 10).convert("RGB")
    photo = Image.blend(photo, ImageChops.multiply(photo, noise.point(lambda p: 200 + p // 5)), 0.35)

    out = io.BytesIO()
    photo.save(out, "JPEG", quality=72)
    return out.getvalue()


def scan(pdf_bytes: bytes, rng: random.Random) -> bytes:
    """A cheap office scanner: grayscale, slightly crooked, speckled, with a gray edge."""
    page = ImageOps.grayscale(first_page_image(pdf_bytes, 150))
    page = page.rotate(rng.uniform(-1.5, 1.5), Image.BICUBIC, expand=True, fillcolor=200)
    noise = Image.effect_noise(page.size, 22)
    page = ImageChops.multiply(page, noise.point(lambda p: 215 + p // 6))
    page = ImageOps.autocontrast(page, cutoff=1)
    border = ImageDraw.Draw(page)
    border.rectangle([0, 0, page.width - 1, 14], fill=150)
    out = io.BytesIO()
    page.save(out, "PNG", optimize=True)
    return out.getvalue()


# ---------------------------------------------------------------- ground truth

def number(value):
    return None if value is None else float(value)


def ground_truth(invoice, file_name, mime_type) -> dict:
    supplier, trap = invoice["supplier"], invoice["trap"]
    issues = EXPECTED_ISSUES[trap]
    printed_tax_id = supplier["tax_id"] if supplier["style"]["show_tax_id"] else None
    return {
        "id": invoice["id"],
        "file": file_name,
        "mime_type": mime_type,
        "variant": invoice["variant"],
        "trap": trap,
        "expected_status": "approved" if not issues else "needs_review",
        "expected_issues": issues,
        # Fields a careful reader cannot read: the right extraction is null, not a guess
        "unreadable": ["invoice_date"] if trap == "illegible_date" else [],
        "invoice": {
            "supplier_name": supplier["name"],
            "supplier_tax_id": printed_tax_id,
            "invoice_number": invoice["number"],
            "invoice_date": invoice["invoice_date"].isoformat(),
            "due_date": invoice["due_date"].isoformat() if invoice["due_date"] else None,
            "currency": "USD",
            "subtotal": number(invoice["subtotal"]),
            "tax": number(invoice["tax"]),
            "shipping": number(invoice["shipping"]),
            "total": number(invoice["total"]),
            "lines": [{"line_number": i, "description": line["description"], "quantity": number(line["quantity"]),
                       "unit_price": number(line["unit_price"]), "amount": number(line["amount"])}
                      for i, line in enumerate(invoice["lines"], 1)],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(),
                        help="date the invoices are relative to (default: today)")
    args = parser.parse_args()

    folder = OUTPUT / "invoices"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.iterdir():
        old.unlink()

    built, truths = {}, []
    for spec in INVOICES:
        rng = random.Random(f"invoice-{spec[0]}")  # per invoice: changing one does not change the others
        if spec[5] == "duplicate":
            invoice = dict(built["01"], id=spec[0], variant=spec[4], trap="duplicate")
        else:
            invoice = build_invoice(spec, args.as_of, rng)
        built[spec[0]] = invoice

        pdf = render_pdf(invoice, smudge_date=invoice["trap"] == "illegible_date")
        stem = f"{invoice['id']}-{invoice['key']}-{invoice['number']}"
        if invoice["variant"] == "photo":
            file_name, mime_type, content = f"{stem}.jpg", "image/jpeg", photograph(pdf, rng)
        elif invoice["variant"] == "scan":
            file_name, mime_type, content = f"{stem}.png", "image/png", scan(pdf, rng)
        else:
            file_name, mime_type, content = f"{stem}.pdf", "application/pdf", pdf
        (folder / file_name).write_bytes(content)
        truths.append(ground_truth(invoice, file_name, mime_type))

    (OUTPUT / "ground-truth.json").write_text(
        json.dumps({"as_of": args.as_of.isoformat(), "invoices": truths}, indent=2) + "\n", encoding="utf-8")
    approved = sum(t["expected_status"] == "approved" for t in truths)
    print(f"{len(truths)} invoices in {folder} ({approved} should be approved automatically, "
          f"{len(truths) - approved} should go to review)")


if __name__ == "__main__":
    main()
