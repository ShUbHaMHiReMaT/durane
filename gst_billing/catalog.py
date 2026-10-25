"""Website and catalogue content for NEU-TECH / Omkar Industries.

Product specifications (codes, dimensions, ply ratings, box quantities) follow the company's own
NEU-TECH brochure. Images live in static/catalog/.
"""

COMPANY = {
    "name": "Omkar Industries",
    "brand": "NEU-TECH",
    "tagline": "Tyre & Tube Repair Products",
    "line": "Tyre and Tube Cut Repair Patches and Solution",
    "person": "Jyoti Kalidas Durane",
    "role": "Proprietor",
    # website contact number for calls and WhatsApp
    "phone": "7619447817",
    "phone_display": "+91 76194 47817",
    "whatsapp": "917619447817",
    "email": "omkarindustries101083@gmail.com",
    "gstin": "29CFQPD1856N1ZR",
    "address_lines": ["Plot No. S-1, Sy. No. 638, 2nd Main Road", "Auto Nagar, Kanbargi Industrial Area",
                      "Belagavi, Karnataka 590016"],
    "head_office_lines": ["LIG/264, KHB Colony, Basavan Kudchi", "Belagavi, Karnataka 591124"],
    "map_query": "Auto Nagar, Kanbargi Industrial Area, Belagavi, Karnataka 590016",
}

INTRO = {
    "title": "NEU-TECH Tyre & Tube Repair Products",
    "tagline": "Professional tyre repair solutions by Omkar Industries, Belagavi",
    "paragraphs": [
        "Omkar Industries manufactures and supplies tyre and tube cut repair patches and repair solutions "
        "under the NEU-TECH brand. Our range covers bias and radial tyres for passenger cars, light and heavy "
        "commercial vehicles, tractors and off-the-road earthmoving equipment.",
        "Every NEU-TECH patch is available in both Versa Cure (dual cure) and Chemical Cure, so workshops can "
        "repair with heat or at room temperature. Our formulations are developed in house and our products are "
        "trusted by tyre workshops, retreaders and dealers who need dependable repairs every day.",
    ],
}

# Short, factual strengths used on the home and about pages
STRENGTHS = [
    ("shield", "High bond strength", "Patches built to stay bonded under load, heat and flexing."),
    ("layers", "Correct construction", "Full-ply nylon bias patches and polyester-reinforced radial patches."),
    ("flame", "Versa or Chemical Cure", "Every size in dual cure (heat or chemical) and chemical cure."),
    ("ruler", "Full size range", "From pin-hole plugs to 265 x 860 mm earthmover patches."),
    ("box", "Ready stock", "Boxed by size for workshops, dealers and distributors."),
    ("rupee", "Economical", "Saves an expensive tyre and gets the vehicle back on the road."),
]

APPLICATIONS = [
    ("bike", "Two-wheelers"), ("car", "Cars & SUVs"), ("van", "LCVs & pick-ups"),
    ("truck", "Trucks & buses"), ("tractor", "Tractors"), ("loader", "Earthmovers & OTR"),
]

# Versa Cure and Chemical Cure, explained on the products, guide and catalogue pages
CURE_TYPES = [
    ("Versa Cure (Dual Cure)", "NTR codes",
     "The base gum cures either chemically or with heat. Its soft, high-tack gum is less affected by moisture, "
     "handling and cement drying time. It cures fully during retreading, in a section mould, bonder or chamber, "
     "or with the heat and pressure the tyre builds up on the road. Use Black Vulcanizing Cement when curing with heat."),
    ("Chemical Cure", "CTR codes",
     "Moulded to a feather edge with a chemical-curing base gum that has very high green tack, plus an "
     "extended poly backing for easy fitting. It vulcanizes at room temperature with Chemical Vulcanizing Cement, "
     "with no heating equipment needed."),
]

CROWN_NOTE = "* Marked sizes are made specially for crown injury repairs."


def _patch(rows):
    """rows: (versa code, versa patch, chemical code, chemical patch, size in mm, ply rating, qty per box)"""
    out = []
    for vc, vn, cc, cn, size, ply, qty in rows:
        out.append({"code": vc, "name": vn.replace("*", "").strip(), "crown": "*" in vn, "chem_code": cc,
                    "chem_name": cn, "size": size, "rating": str(ply), "qty": qty})
    return out


SPECS = {
    "bias-tyre-patches": _patch([
        ("NTR001", "BP-0", "CTR201", "BP-00", "55 Dia", 1, 25), ("NTR002", "BP-1", "CTR202", "BP-01", "75 Dia", 2, 20),
        ("NTR003", "BP-2", "CTR203", "BP-02", "90 Dia", 2, 10), ("NTR004", "BP-3", "CTR204", "BP-03", "132 x 132", 2, 10),
        ("NTR005", "BP-4", "CTR205", "BP-04", "152 x 152", 4, 10), ("NTR006", "BP-5", "CTR206", "BP-05", "177 x 177", 4, 10),
        ("NTR007", "BP-6", "CTR207", "BP-06", "240 x 240", 6, 5), ("NTR008", "BP-7", "CTR208", "BP-07", "290 x 290", 6, 5),
        ("NTR009", "BP-8", "CTR209", "BP-08", "340 x 340", 6, 5), ("NTR010", "BP-9", "CTR210", "BP-09", "380 x 380", 8, 3),
        ("NTR011", "BP-10", "CTR211", "BP-010", "430 x 430", 8, 3),
    ]),
    "radial-patches-passenger": _patch([
        ("NTR012", "RD 10", "CTR212", "RD 110", "55 x 80", 1, 20), ("NTR013", "RD 10HD", "CTR213", "RD 110HD", "65 x 80", 1, 10),
        ("NTR014", "RD 10HD+", "CTR214", "RD 110HD+", "75 x 90", 1, 10), ("NTR015", "RD 12", "CTR215", "RD 112", "60 x 110", 1, 10),
        ("NTR016", "RD 12HD", "CTR216", "RD 112HD", "70 x 115", 1, 10), ("NTR017", "RD 14", "CTR217", "RD 114", "78 x 140", 1, 10),
        ("NTR018", "RD 14HD", "CTR218", "RD 114HD", "85 x 130", 1, 10), ("NTR019", "RD 14HD+", "CTR219", "RD 114HD+", "84 x 163", 1, 10),
        ("NTR020", "RD 15HD", "CTR220", "RD 115HD", "75 x 90", 1, 10),
    ]),
    "radial-patches-truck": _patch([
        ("NTR021", "RD 20", "CTR221", "RD 120", "75 x 125", 2, 10), ("NTR022", "RD 20 HD", "CTR222", "RD 120 HD", "85 x 130", 2, 10),
        ("NTR023", "RD 20 HD+", "CTR223", "RD 120 HD+", "90 x 148", 2, 10), ("NTR024", "RD 22", "CTR224", "RD 122", "75 x 165", 2, 10),
        ("NTR025", "RD 22 HD", "CTR225", "RD 122 HD", "85 x 180", 2, 10), ("NTR026", "RD 22 HD+", "CTR226", "RD 122 HD+", "95 x 180", 2, 10),
        ("NTR027", "RD 24", "CTR227", "RD 124", "75 x 215", 2, 10), ("NTR028", "RD 24 HD", "CTR228", "RD 124 HD", "90 x 220", 3, 10),
        ("NTR029", "RD 26", "CTR229", "RD 126", "75 x 250", 3, 10), ("NTR030", "RD 26 HD", "CTR230", "RD 126 HD", "90 x 250", 4, 10),
        ("NTR031", "RD 33*", "CTR231", "RD 133", "100 x 125", 4, 10), ("NTR032", "RD 33+*", "CTR232", "RD 133+", "114 x 128", 4, 10),
        ("NTR033", "RD 35*", "CTR233", "RD 135", "125 x 150", 4, 10), ("NTR034", "RD 35+*", "CTR234", "RD 135+", "135 x 162", 4, 10),
        ("NTR035", "RD 37*", "CTR235", "RD 137", "125 x 175", 4, 10), ("NTR036", "RD 37+*", "CTR236", "RD 137+", "140 x 180", 4, 10),
        ("NTR037", "RD 40", "CTR237", "RD 140", "100 x 200", 3, 10), ("NTR038", "RD 40 HD", "CTR238", "RD 140 HD", "110 x 210", 4, 10),
        ("NTR039", "RD 40 HD+", "CTR239", "RD 140 HD+", "120 x 215", 4, 10), ("NTR040", "RD 42", "CTR240", "RD 142", "125 x 250", 4, 10),
        ("NTR041", "RD 42 HD", "CTR241", "RD 142 HD", "135 x 260", 4, 10), ("NTR042", "RD 42 HD+", "CTR242", "RD 142 HD+", "140 x 270", 4, 10),
        ("NTR043", "RD 44", "CTR243", "RD 144", "125 x 325", 4, 5), ("NTR044", "RD 44+", "CTR244", "RD 144+", "140 x 335", 4, 5),
    ]),
    "radial-patches-earthmover": _patch([
        ("NTR045", "RD 45*", "CTR245", "RD 145", "185 x 235", 4, 5), ("NTR046", "RD 46", "CTR246", "RD 146", "140 x 400", 4, 5),
        ("NTR098", "RD 47*", "CTR298", "RD 147", "140 x 400", 4, 5), ("NTR047", "RD 50", "CTR247", "RD 150", "190 x 500", 4, 5),
        ("NTR048", "RD 52", "CTR248", "RD 152", "250 x 450", 4, 5), ("NTR049", "RD 56*", "CTR249", "RD 156", "253 x 635", 6, 5),
        ("NTR050", "RD 60", "CTR250", "RD 160", "265 x 860", 6, 3), ("NTR051", "RD 65*", "CTR251", "RD 165", "330 x 420", 6, 3),
        ("NTR052", "RD 70", "CTR252", "RD 170", "315 x 560", 5, 3), ("NTR053", "RD 72*", "CTR253", "RD 172", "215 x 710", 6, 3),
    ]),
    "radial-patches-tractor": _patch([
        ("NTR054", "RD 80", "CTR254", "RD 180", "150 x 195", 6, 5), ("NTR055", "RD 82", "CTR255", "RD 182", "190 x 250", 6, 5),
        ("NTR056", "RD 84", "CTR256", "RD 184", "215 x 290", 6, 5), ("NTR057", "RD 86", "CTR257", "RD 186", "245 x 340", 8, 5),
    ]),
    "max-grip-plug-patches": [
        {"code": "NTL081", "name": "Neu-Plug 3", "size": "Stem 3 mm x 30 mm, patch dia 45 mm", "rating": "Pin hole", "qty": 18},
        {"code": "NTL082", "name": "Neu-Plug 6", "size": "Stem 6 mm x 35 mm, patch dia 58 mm", "rating": "1/8\" (3 mm)", "qty": 20},
        {"code": "NTL083", "name": "Neu-Plug 9", "size": "Stem 9 mm x 35 mm, patch dia 58 mm", "rating": "1/4\" (6 mm)", "qty": 20},
        {"code": "NTL084", "name": "Neu-Plug 12", "size": "Stem 12 mm x 50 mm, patch dia 85 mm", "rating": "3/8\" (9 mm)", "qty": 8},
    ],
}

FAMILIES = [
    {
        "slug": "bias-tyre-patches",
        "title": "Bias / Diagonal Tyre Patches",
        "short": "BP Series",
        "summary": "Full-ply nylon patches for cross-ply tyres, tube type and tubeless. Injuries from 3 mm to 125 mm.",
        "kind": "patch",
        "icon": "layers",
        "uses": ["Cars", "LCVs", "Trucks & buses", "Tractors"],
        "images": ["bias-tyre-patches-sizes.jpg", "bias-tyre-patches-showroom.jpg", "bias-tyre-patches-range.jpg"],
        "text": [
            "NEU-TECH bias patches repair punctures, reinforced repairs and section repairs in passenger, light truck, "
            "truck, heavy-duty truck and tractor bias tyres, both tube type and tubeless.",
            "They use full-ply construction: nylon cord plies with a special rubber compound and cushion gum between "
            "them that works as a shock-absorbing layer. Each patch is die-cut and moulded into an octagonal shape "
            "for strength and easy fitting. Injuries from 3 mm (1/8\") up to 125 mm (5\") can be repaired.",
        ],
        "points": ["Full-ply nylon construction with shock-absorbing cushion layer", "Octagonal shape for strength and easy fitting",
                   "Repairs injuries from 3 mm to 125 mm", "Available in Versa Cure and Chemical Cure"],
    },
    {
        "slug": "radial-patches-passenger",
        "title": "Radial Tyre Patches: Passenger Cars",
        "short": "RD 10 to RD 15",
        "summary": "Radial patches for car and SUV tyres, in standard, HD and HD+ heavy-duty versions.",
        "kind": "patch",
        "icon": "car",
        "uses": ["Cars", "SUVs"],
        "images": ["radial-patches-with-boxes.jpg", "heavy-duty-radial-patches-sizes.jpg", "radial-patches-rd-series.jpg"],
        "text": [
            "NEU-TECH radial patches repair punctures, reinforced injuries and section injuries in passenger car "
            "radial and tubeless tyres.",
            "Each patch uses directionally laid polyester cords on a toughened wedge-construction platform. This adds "
            "strength where the tyre needs it and keeps heat build-up low while the patch stays flexible. HD and HD+ "
            "versions give extra strength for heavier cars and SUVs.",
        ],
        "points": ["Directional polyester cords", "Toughened wedge-construction platform", "Low heat build-up, stays flexible",
                   "Standard, HD and HD+ versions"],
    },
    {
        "slug": "radial-patches-truck",
        "title": "Radial Tyre Patches: LCV & Truck",
        "short": "RD 20 to RD 44",
        "summary": "Heavy-duty radial patches for LCV, truck and bus tyres, including crown repair sizes.",
        "kind": "patch",
        "icon": "truck",
        "uses": ["LCVs", "Trucks", "Buses"],
        "images": ["heavy-duty-radial-patches-sizes.jpg", "radial-patches-with-boxes.jpg", "radial-patch-range-display.jpg"],
        "text": [
            "Radial patches for light commercial vehicle, truck, heavy-duty truck and bus tyres. Steel-belted "
            "commercial tyres run at high loads and pressures, so these sizes step up in ply rating and footprint, "
            "with HD and HD+ versions for the heaviest work.",
            "RD 33, RD 35 and RD 37 (and their + versions) are made specially for crown injury repairs.",
        ],
        "points": ["24 sizes from 75 x 125 mm to 140 x 335 mm", "Ply ratings 2 to 4",
                   "Dedicated crown-repair sizes", "Available in Versa Cure and Chemical Cure"],
    },
    {
        "slug": "radial-patches-earthmover",
        "title": "Radial Tyre Patches: Earthmover (OTR)",
        "short": "RD 45 to RD 72",
        "summary": "Large radial patches for off-the-road tyres on loaders, dumpers, graders and mining machines.",
        "kind": "patch",
        "icon": "loader",
        "uses": ["Loaders", "Dumpers", "Graders", "Mining"],
        "images": ["radial-patches-rd-series.jpg", "neu-tech-full-range-radial-patches.jpg"],
        "text": [
            "NEU-TECH OTR patches repair punctures, reinforced injuries and section injuries in radial off-the-road "
            "tyres of heavy-duty machines.",
            "These units have an elongated step-down between plies and extra top cover stock, so the patch can be "
            "placed over the injury and fixed in any flex area of the tyre. Large sizes allow big injuries to be "
            "repaired instead of replacing an expensive OTR tyre.",
        ],
        "points": ["Elongated step-down between plies", "Extra top cover stock for flex areas",
                   "Sizes up to 265 x 860 mm", "RD 45, 47, 56, 65 and 72 made for crown injuries"],
    },
    {
        "slug": "radial-patches-tractor",
        "title": "Radial Tyre Patches: Tractor",
        "short": "RD 80 to RD 86",
        "summary": "Radial patches sized for front and rear agricultural tractor tyres, ply rating 6 to 8.",
        "kind": "patch",
        "icon": "tractor",
        "uses": ["Tractors", "Farm equipment"],
        "images": ["neu-tech-showroom-range.jpg", "radial-patches-rd-series.jpg"],
        "text": [
            "RD patches sized for agricultural tractor radial tyres. They are made to cope with the deep lugs, "
            "low pressures and heavy field work typical of farm tyres.",
            "For the best bond, use NEU-TECH Chemical Vulcanizing Fluid with these patches.",
        ],
        "points": ["Four sizes from 150 x 195 mm to 245 x 340 mm", "Ply rating 6 to 8",
                   "Flexible for low-pressure farm use"],
    },
    {
        "slug": "max-grip-plug-patches",
        "title": "Max Grip Plug Patches (PWPP)",
        "short": "Neu-Plug Series · Dual Cure",
        "summary": "Pilot Wire Plug Patches: one-piece plug and patch for bias and radial tyres.",
        "kind": "plug",
        "icon": "plug",
        "uses": ["Cars", "LCVs", "Trucks", "Buses"],
        "images": ["max-grip-plug-patch-packs.jpg", "max-grip-plug-patch-boxes.jpg", "radial-patch-repair-in-use.jpg",
                   "neu-plug-specification-chart.jpg"],
        "text": [
            "NEU-TECH Pilot Wire Plug Patches (PWPP) fill and seal the injury in one piece: the stem fills the "
            "injury channel and the cap seals the inner liner. They are used in bias and radial tyres, especially "
            "passenger, light truck and truck tyres.",
            "A specially designed rubber compound lets the repair flex and resist heat, and the dual-cure cushion gum "
            "coat gives a permanent bond with the tyre.",
        ],
        "points": ["One-piece plug and patch", "Dual-cure cushion gum coat", "Flexes and resists heat",
                   "Four sizes, pin hole to 9 mm injuries"],
    },
    {
        "slug": "chemicals",
        "title": "Vulcanizing Fluid & Cements",
        "short": "Chemicals",
        "summary": "Pre-cleansing fluid, chemical vulcanizing fluid and black vulcanizing cement. Tubes and tins.",
        "kind": "none",
        "icon": "droplet",
        "uses": ["All patch repairs"],
        "images": ["pre-cleansing-fluid-and-vulcanizing-solution.jpg"],
        "text": [
            "A good repair starts with a clean surface. NEU-TECH pre-cleansing fluid removes dirt, grease and "
            "release agents from the buffed area, and the vulcanizing fluid builds the bond between patch and tyre.",
            "Use Chemical Vulcanizing Cement for room-temperature (chemical) curing and Black Vulcanizing Cement when "
            "curing Versa Cure patches with heat. Available in tube and tin packs.",
        ],
        "points": ["Pre-cleansing fluid", "Chemical vulcanizing fluid for cold cure",
                   "Black vulcanizing cement for heat cure", "Tubes and tins in several sizes"],
    },
    {
        "slug": "tools-and-kits",
        "title": "Repair Kits, Tools & Accessories",
        "short": "Tools & Kits",
        "summary": "Stitching rollers, scrapers, buffing tools, brushes, valves and complete repair kits.",
        "kind": "none",
        "icon": "wrench",
        "uses": ["Workshops", "Roadside service"],
        "images": ["repair-kit-tools-and-patches.jpg", "professional-tyre-repair-solutions.jpg",
                   "repair-kit-radial-patches-and-valves.jpg"],
        "text": [
            "Complete the job with NEU-TECH repair tools: stitching rollers, scrapers, buffing tools, "
            "brushes and valves, supplied with patches as professional repair kits.",
        ],
        "points": ["Stitching rollers and scrapers", "Buffing tools and brushes",
                   "Repair kits with patches, solution and tools"],
    },
]

# Which product to use: shown on the repair guide page
SELECTOR = [
    ("Puncture up to 9 mm in a bias or radial tyre", "Max Grip Plug Patch (PWPP)", "max-grip-plug-patches"),
    ("Cut or puncture in a bias (cross-ply) tyre", "BP Series bias patch", "bias-tyre-patches"),
    ("Injury in a car or SUV radial tyre", "RD 10 to RD 15", "radial-patches-passenger"),
    ("Injury in an LCV, truck or bus radial tyre", "RD 20 to RD 44", "radial-patches-truck"),
    ("Injury in a loader, dumper or grader tyre", "RD 45 to RD 72", "radial-patches-earthmover"),
    ("Injury in a tractor radial tyre", "RD 80 to RD 86", "radial-patches-tractor"),
]

REPAIR_STEPS = [
    ("Inspect", "Remove the tyre, find the injury and mark it on the inside and outside."),
    ("Clean", "Clean the inner liner around the injury with NEU-TECH pre-cleansing fluid."),
    ("Buff", "Buff an area slightly larger than the patch to an even texture, then remove all dust."),
    ("Apply cement", "Chemical Cure: apply Chemical Vulcanizing Cement. Heat cure: apply Black Vulcanizing Cement. Let it dry completely."),
    ("Fit the patch", "Remove the backing and centre the patch over the injury. On radial patches, follow the direction mark."),
    ("Stitch", "Stitch firmly from the centre outward with a roller to push out trapped air."),
]

FAQ = [
    ("What is the difference between Versa Cure and Chemical Cure?",
     "Versa Cure (dual cure) patches cure either with heat or chemically, so they also cure during retreading or in a "
     "section mould. Chemical Cure patches cure at room temperature with Chemical Vulcanizing Cement. Every NEU-TECH "
     "patch size is available in both."),
    ("Which patch should I use for a radial tyre?",
     "Use an RD radial patch. Bias patches are built for cross-ply tyres and should not be used in radial tyres. "
     "For small punctures up to 9 mm, a Max Grip plug patch fills and seals the injury in one piece."),
    ("Can I buy in small quantities?",
     "Yes. Every size is packed in boxes, so workshops can order by the box. Dealers and distributors get "
     "special pricing. Contact us for the current price list."),
    ("Do you supply outside Karnataka?",
     "Yes. We dispatch to dealers and workshops in other states as well. Send us an enquiry with your "
     "location and requirement."),
    ("What is your warranty and return policy?",
     "Our guarantee covers products that are stored and used as instructed. Products can be returned within "
     "ten days of delivery; returns are not accepted after that."),
    ("How do I become a NEU-TECH distributor?",
     "Fill in the distributor form on this website or call us. We will share our distributor terms and "
     "price list."),
]

GALLERY = [
    "neu-tech-full-range-display.jpg", "neu-tech-full-range-precision-technology.jpg", "neu-tech-product-display-stand.jpg",
    "radial-patches-rd-series.jpg", "radial-patches-with-boxes.jpg", "professional-tyre-repair-solutions.jpg",
    "bias-tyre-patches-range-with-tools.jpg", "radial-patch-repair-in-use.jpg", "max-grip-plug-patch-workshop.jpg",
    "max-grip-plug-patch-range.jpg", "max-grip-plug-patch-packs.jpg", "plug-patch-closeup.jpg",
    "bias-tyre-patches-sizes.jpg", "bias-tyre-patches-showroom.jpg", "heavy-duty-radial-patches-sizes.jpg",
    "repair-kit-tools-and-patches.jpg", "neu-tech-full-range-warehouse.jpg", "rise-rely-repair-poster.jpg",
    "advanced-repair-technology-poster.jpg", "tyre-manufacturing-line.jpg",
]

HERO_IMAGE = "neu-tech-full-range-display.jpg"
LOGO = "omkar-industries-logo.png"
BANNER = "neu-tech-logo-banner.jpg"
CONTACT_IMAGE = "omkar-industries-visiting-card.jpg"


def family(slug):
    return next((f for f in FAMILIES if f["slug"] == slug), None)


def total_sizes():
    return sum(len(rows) for rows in SPECS.values())


def caption(filename):
    words = filename.rsplit(".", 1)[0].replace("-", " ").title()
    return words.replace("Neu Tech", "NEU-TECH").replace("Neu Plug", "Neu-Plug").replace("Rd ", "RD ")
