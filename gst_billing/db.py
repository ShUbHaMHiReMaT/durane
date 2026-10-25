import json
import os
import re
import sqlite3

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "billing.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'other',      -- omkar | ssi | other
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    state TEXT DEFAULT '',
    state_code TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    bank_holder TEXT DEFAULT '',
    bank_name TEXT DEFAULT '',
    bank_account TEXT DEFAULT '',
    bank_ifsc TEXT DEFAULT '',
    bank_branch TEXT DEFAULT '',
    upi_id TEXT DEFAULT '',
    logo TEXT DEFAULT '',
    invoice_prefix TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    address TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    state TEXT DEFAULT '',
    state_code TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT DEFAULT '',
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT DEFAULT '',
    hsn TEXT DEFAULT '40169310',
    unit TEXT DEFAULT 'unit',
    price_internal REAL,
    price_external REAL,
    price_other REAL,
    units_per_box INTEGER,
    mrp REAL,
    size TEXT DEFAULT '',                    -- dimensions shown in the catalogue
    rating TEXT DEFAULT ''                   -- ply rating / injury size shown in the catalogue
);
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_type TEXT NOT NULL,                 -- pi_excl | pi_incl | omkar | ssi | other
    price_list TEXT NOT NULL,                -- internal | external | other
    invoice_no TEXT NOT NULL,
    date TEXT NOT NULL,
    company_id INTEGER,
    seller TEXT NOT NULL,                    -- JSON snapshot of the From company
    buyer TEXT NOT NULL,                     -- JSON snapshot of the client
    tax_mode TEXT NOT NULL DEFAULT 'none',   -- none | igst | cgst_sgst
    igst_rate REAL DEFAULT 0,
    cgst_rate REAL DEFAULT 0,
    sgst_rate REAL DEFAULT 0,
    qty_pct REAL DEFAULT 100,
    items TEXT NOT NULL,                     -- JSON list
    details TEXT DEFAULT '{}',               -- JSON: delivery note, dispatch etc.
    subtotal REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    round_off REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'enquiry',    -- enquiry | distributor
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    city TEXT DEFAULT '',
    products TEXT DEFAULT '',
    message TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',      -- new | contacted | closed
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

COMPANIES = [
    dict(kind="omkar", name="OMKAR INDUSTRIES",
         address="Plot No. S-1, Sy. No.-638,\n2nd Main Road, Auto Nagar,\nKanbargi Industrial Area,\nBelagavi, Karnataka - 590016",
         gstin="29CFQPD1856N1ZR", state="Karnataka", state_code="29",
         email="das_durane@yahoo.co.in", phone="7676146166 / 7975785928", pan="CFQPD1856N",
         bank_holder="OMKAR INDUSTRIES", bank_name="State Bank of India", bank_account="42815450714",
         bank_ifsc="SBIN0008789", bank_branch="Malamaruti (West)", logo="omkar.png", invoice_prefix="OMKAR"),
    dict(kind="ssi", name="Shree Siddhivinayak Industries",
         address="Plot No. 25, 9th Cross, Workshop No. 259,\nKanbargi Industrial Area,\nBelagavi - 590015",
         gstin="29BGMPT4805P1ZF", state="Karnataka", state_code="29",
         email="Shreesiddhivinayak1817@gmail.com", phone="9341100458 / 77957 59983", pan="BGMPT4805P",
         bank_holder="Shree Siddhivinayak Industries", bank_name="State Bank of India", bank_account="44867812840",
         bank_ifsc="SBIN0040363", bank_branch="Hindadi", logo="", invoice_prefix="SSI"),
]

# (code, name, category, units_per_box, mrp, internal, external) from the NeuTech price lists 2026
PRODUCTS = [
    ("BP-0", "BP 0", "Bias / Diagonal", 25, 186, 3.11, 3.88),
    ("BP-1", "BP 1", "Bias / Diagonal", 20, 200, 4.16, 5.20),
    ("BP-2", "BP 2", "Bias / Diagonal", 20, 318, 6.64, 8.29),
    ("BP-3", "BP 3", "Bias / Diagonal", 10, 250, 10.46, 13.07),
    ("BP-4", "BP 4", "Bias / Diagonal", 10, 448, 18.73, 23.41),
    ("BP-5", "BP 5", "Bias / Diagonal", 10, 682, 28.48, 35.59),
    ("BP-6", "BP 6", "Bias / Diagonal", 10, 1142, 47.63, 59.53),
    ("BP-7", "BP 7", "Bias / Diagonal", 5, 880, 73.38, 91.73),
    ("BP-8", "BP 8", "Bias / Diagonal", 5, 1232, 102.82, 128.52),
    ("BP-9", "BP 9", "Bias / Diagonal", 3, 1108, 154.06, 192.57),
    ("BP-10", "BP 10", "Bias / Diagonal", 3, 1479, 205.63, 257.04),
    ("RD-10", "RD 10", "Passenger Radial", 20, 305, 6.38, 7.98),
    ("RD-12", "RD 12", "Passenger Radial", 10, 208, 8.69, 10.86),
    ("RD-14", "RD 14", "Passenger Radial", 10, 326, 13.62, 17.03),
    ("RD-15", "RD 15", "Passenger Radial", 10, 285, 11.94, 14.93),
    ("RD-20", "RD 20", "LCV & Truck Radial", 10, 376, 15.67, 19.58),
    ("RD-22", "RD 22", "LCV & Truck Radial", 10, 474, 19.76, 24.70),
    ("RD-24", "RD 24", "LCV & Truck Radial", 10, 655, 27.31, 34.14),
    ("RD-26", "RD 26", "LCV & Truck Radial", 10, 863, 35.99, 44.98),
    ("RD-33", "RD 33", "LCV & Truck Radial", 10, 685, 28.64, 35.80),
    ("RD-35", "RD 35", "LCV & Truck Radial", 10, 880, 36.71, 45.88),
    ("RD-37", "RD 37", "LCV & Truck Radial", 10, 1252, 52.22, 65.28),
    ("RD-40", "RD 40", "LCV & Truck Radial", 10, 795, 33.18, 41.48),
    ("RD-42", "RD 42", "LCV & Truck Radial", 10, 1556, 64.93, 81.17),
    ("RD-44", "RD 44", "LCV & Truck Radial", 5, 863, 71.99, 89.98),
    ("RD-45", "RD 45", "Earthmover Radial", 5, 930, 77.62, 97.03),
    ("RD-46", "RD 46", "Earthmover Radial", 5, 1057, 88.28, 110.36),
    ("RD-47", "RD 47", "Earthmover Radial", 5, 1861, 155.24, 194.05),
    ("RD-49", "RD 49", "Earthmover Radial", 5, 2071, 181.39, 226.74),
    ("RD-50", "RD 50", "Earthmover Radial", 5, 2993, 249.65, 312.06),
    ("RD-52", "RD 52", "Earthmover Radial", 5, 4371, 364.66, 455.83),
    ("RD-56", "RD 56", "Earthmover Radial", 5, 5707, 476.07, 595.09),
    ("RD-60", "RD 60", "Earthmover Radial", 5, 6998, 583.88, 729.86),
    ("RD-65", "RD 65", "Earthmover Radial", 5, 4060, 355.66, 444.57),
    ("RD-70", "RD 70", "Earthmover Radial", 5, 5088, 424.42, 530.52),
    ("RD-72", "RD 72", "Earthmover Radial", 5, 5972, 498.20, 622.75),
    ("RD-80", "RD 80", "Tractor Radial", 5, 1510, 126.00, 157.50),
    ("RD-82", "RD 82", "Tractor Radial", 5, 2068, 172.54, 215.67),
    ("RD-84", "RD 84", "Tractor Radial", 5, 2702, 225.46, 281.82),
    ("RD-86", "RD 86", "Tractor Radial", 5, 3299, 275.18, 343.98),
    ("WTPP-3", "PLUG PATCH 3MM", "Plug Patch", 18, 555, 9.45, 16.07),
    ("WTPP-6", "PLUG PATCH 6MM", "Plug Patch", 20, 725, 12.285, 18.90),
    ("WTPP-9", "PLUG PATCH 9MM", "Plug Patch", 20, 798, 14.175, 20.79),
    ("WTPP-12", "PLUG PATCH 12MM", "Plug Patch", 8, 566, 25.50, 36.85),
]

# (code, size, injury size) from the Neu-Plug series specification chart
PLUG_SPECS = [
    ("WTPP-3", "Stem 3 mm x 30 mm, Patch dia 45 mm", "Pin hole"),
    ("WTPP-6", "Stem 6 mm x 35 mm, Patch dia 58 mm", "3 mm"),
    ("WTPP-9", "Stem 9 mm x 35 mm, Patch dia 58 mm", "6 mm"),
    ("WTPP-12", "Stem 12 mm x 50 mm, Patch dia 85 mm", "9 mm"),
]

DEFAULT_SETTINGS = {
    "terms": "1. Goods once sold will not be taken back or exchanged.\n"
             "2. Interest @ 18% p.a. will be charged if payment is not made within the due date.\n"
             "3. Our responsibility ceases once the goods leave our premises.\n"
             "4. Subject to Belagavi jurisdiction only.",
    "default_igst": "18",
    "default_cgst": "9",
    "default_sgst": "9",
    "eway_threshold": "50000",
}


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init():
    conn = connect()
    conn.executescript(SCHEMA)
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(products)")]
    for col in ("size", "rating"):
        if col not in cols:
            conn.execute(f"ALTER TABLE products ADD COLUMN {col} TEXT DEFAULT ''")
            if col == "rating":
                conn.executemany("UPDATE products SET size=?, rating=? WHERE code=?",
                                 [(s, r, c) for c, s, r in PLUG_SPECS])
    if not conn.execute("SELECT 1 FROM companies LIMIT 1").fetchone():
        for c in COMPANIES:
            cols = ",".join(c)
            conn.execute(f"INSERT INTO companies ({cols}) VALUES ({','.join('?' * len(c))})", list(c.values()))
    if not conn.execute("SELECT 1 FROM products LIMIT 1").fetchone():
        conn.executemany(
            "INSERT INTO products (code, name, category, units_per_box, mrp, price_internal, price_external) "
            "VALUES (?,?,?,?,?,?,?)", PRODUCTS)
        conn.executemany("UPDATE products SET size=?, rating=? WHERE code=?", [(s, r, c) for c, s, r in PLUG_SPECS])
    # sizes and ply ratings from the NEU-TECH brochure fill empty catalogue fields of billing products
    import catalog
    for rows in catalog.SPECS.values():
        for r in rows:
            m = re.fullmatch(r"Neu-Plug (\d+)", r["name"])
            name = f"PLUG PATCH {m.group(1)}MM" if m else r["name"].replace("-", " ")
            conn.execute("UPDATE products SET size=? WHERE name=? AND (size IS NULL OR size='')", (r["size"], name))
            conn.execute("UPDATE products SET rating=? WHERE name=? AND (rating IS NULL OR rating='')", (r["rating"], name))
    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
    conn.commit()
    conn.close()


def row(r):
    return dict(r) if r else None


def rows(rs):
    return [dict(r) for r in rs]


def invoice_dict(r):
    d = dict(r)
    for k in ("seller", "buyer", "items", "details"):
        d[k] = json.loads(d[k] or ("[]" if k == "items" else "{}"))
    return d
