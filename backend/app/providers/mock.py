"""模拟数据源：按地址哈希生成稳定的假数据，形状与真实公共记录一致。"""

import hashlib
import random
import re
from datetime import date, timedelta

from .base import AddressCandidate, FieldValue, PropertyDataProvider, PropertyLookupResult, Valuation

BUILTIN: list[AddressCandidate] = [
    AddressCandidate("4928 NW Fisk Ave, Kansas City, MO 64151", "4928 NW Fisk Ave", "Kansas City", "MO", "64151", 39.2011, -94.6320),
    AddressCandidate("10404 NW 57th Terr, Parkville, MO 64152", "10404 NW 57th Terr", "Parkville", "MO", "64152", 39.2204, -94.6881),
    AddressCandidate("200 NE 43rd St, Kansas City, MO 64116", "200 NE 43rd St", "Kansas City", "MO", "64116", 39.1710, -94.5710),
    AddressCandidate("6380 NW 49th St, Kansas City, MO 64151", "6380 NW 49th St", "Kansas City", "MO", "64151", 39.2040, -94.6410),
    AddressCandidate("12103 W 64th St, Shawnee, KS 66216", "12103 W 64th St", "Shawnee", "KS", "66216", 39.0070, -94.7330),
    AddressCandidate("4312 N Walnut St, Kansas City, MO 64116", "4312 N Walnut St", "Kansas City", "MO", "64116", 39.1690, -94.5780),
    AddressCandidate("1842 Alvarado Terrace, Los Angeles, CA 90006", "1842 Alvarado Terrace", "Los Angeles", "CA", "90006", 34.0470, -118.2790),
    AddressCandidate("725 S Mariposa Ave, Los Angeles, CA 90005", "725 S Mariposa Ave", "Los Angeles", "CA", "90005", 34.0590, -118.3010),
    AddressCandidate("5601 N Holmes St, Kansas City, MO 64118", "5601 N Holmes St", "Kansas City", "MO", "64118", 39.1930, -94.5690),
    AddressCandidate("3419 Pasadena Ave, Los Angeles, CA 90031", "3419 Pasadena Ave", "Los Angeles", "CA", "90031", 34.0790, -118.2120),
]

PROPERTY_TYPES = ["Single Family", "Single Family", "Single Family", "Duplex", "Townhouse"]
STYLES = ["Ranch", "Split Level", "Colonial", "Craftsman", "Spanish Revival", "Mediterranean", "Bungalow", "Cape Cod"]
BASEMENTS = ["Slab on Grade", "Full Basement", "Partial Basement", "Crawl Space"]
LENDERS = ["HomeServices Lending LLC", "Wells Fargo Bank NA", "Quicken Loans", "US Bank NA", "Commerce Bank"]
LOAN_TYPES = ["Conventional", "FHA", "VA", "Conventional"]
SURNAMES = ["Short", "Robertson", "Nguyen", "Garcia", "Miller", "Thompson", "Patel", "Kim", "Anderson", "Lopez"]
GIVEN = ["Travis A", "David G", "Christina", "Michael", "Sarah", "James", "Priya", "Daniel", "Laura", "Carlos"]


def _seed(address: str) -> random.Random:
    h = hashlib.sha256(address.strip().lower().encode()).hexdigest()
    return random.Random(int(h[:12], 16))


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


# KAN-71：这里所有数字都是随机生成的，来源一律标「演示数据」，把握度不给——
# 随机值谈不上把握度。真实 provider 接上后各自发自己的来源，这里不改写。
DEMO_SOURCE = "demo"


class MockProvider(PropertyDataProvider):
    name = "mock"

    def geocode(self, query: str) -> list[AddressCandidate]:
        q = _norm(query)
        if not q:
            return []
        hits = [c for c in BUILTIN if q in _norm(c.label)]
        # 若用户输入的是一个看起来完整的新地址，也把它作为候选拼出来
        if not hits and len(q) >= 5:
            rnd = _seed(query)
            city, state, zip_ = rnd.choice([
                ("Kansas City", "MO", "64116"), ("Overland Park", "KS", "66210"),
                ("Los Angeles", "CA", "90026"), ("Pasadena", "CA", "91101"),
            ])
            street = query.strip().title()
            hits = [AddressCandidate(f"{street}, {city}, {state} {zip_}", street, city, state, zip_,
                                     round(34 + rnd.random() * 6, 4), round(-118 + rnd.random() * 24, 4))]
        return hits[:5]

    def lookup(self, address: str) -> PropertyLookupResult:
        cands = self.geocode(address)
        cand = cands[0] if cands else AddressCandidate(address, address, "", "", "")
        rnd = _seed(cand.label)

        year_built = rnd.randint(1925, 2005)
        sqft = rnd.randint(1100, 3200)
        beds = rnd.choice([2, 3, 3, 3, 4, 4, 5])
        baths_full = rnd.choice([1, 2, 2, 3])
        baths_half = rnd.choice([0, 0, 1])
        style = rnd.choice(STYLES)
        if cand.state == "CA":
            style = rnd.choice(["Spanish Revival", "Mediterranean", "Craftsman", "Bungalow"])
        apn = f"{rnd.randint(10, 99)}-{rnd.randint(100, 999)}-{rnd.randint(10, 99)}-{rnd.randint(10, 99)}-{rnd.randint(0, 9)}.000"

        fields = [
            FieldValue("property_type", rnd.choice(PROPERTY_TYPES), DEMO_SOURCE, None),
            FieldValue("style", style, DEMO_SOURCE, None, "公共记录里的风格字段常不准确，建议结合街景确认"),
            FieldValue("year_built", str(year_built), DEMO_SOURCE, None),
            FieldValue("sqft", str(sqft), DEMO_SOURCE, None),
            FieldValue("beds", str(beds), DEMO_SOURCE, None),
            FieldValue("baths_full", str(baths_full), DEMO_SOURCE, None),
            FieldValue("baths_half", str(baths_half), DEMO_SOURCE, None),
            FieldValue("stories", str(rnd.choice([1, 1, 2, 2, 3])), DEMO_SOURCE, None),
            FieldValue("garage_spaces", str(rnd.choice([0, 1, 2, 2, 3])), DEMO_SOURCE, None),
            FieldValue("basement", rnd.choice(BASEMENTS), DEMO_SOURCE, None),
            FieldValue("lot_sqft", str(rnd.randint(4000, 14000)), DEMO_SOURCE, None),
            FieldValue("land_use", "Residential", DEMO_SOURCE, None),
            FieldValue("apn", apn, DEMO_SOURCE, None),
        ]

        owner_name = f"{rnd.choice(SURNAMES)}, {rnd.choice(GIVEN)}"
        last_sale = date(rnd.randint(2008, 2021), rnd.randint(1, 12), rnd.randint(1, 28))
        last_amount = float(rnd.randint(90, 420) * 1000)
        owner = {
            "name": owner_name,
            "mailing_address": cand.label,
            "phone": None,
            "email": None,
            "owner_since": last_sale.isoformat(),
        }

        mortgages = []
        if rnd.random() < 0.8:
            orig = round(last_amount * rnd.uniform(0.7, 0.95), -2)
            years = max(1, (date.today() - last_sale).days // 365)
            est = round(orig * max(0.35, 1 - years * 0.03), -2)
            rate = round(rnd.uniform(2.9, 6.8), 2)
            mortgages.append({
                "recording_date": (last_sale + timedelta(days=rnd.randint(5, 30))).isoformat(),
                "lender": rnd.choice(LENDERS),
                "loan_type": rnd.choice(LOAN_TYPES),
                "term_months": 360,
                "original_balance": orig,
                "est_balance": est,
                "rate": rate,
                "payment": round(orig * (rate / 100 / 12) / (1 - (1 + rate / 100 / 12) ** -360), 0),
            })

        prev_owner = f"{rnd.choice(SURNAMES)}, {rnd.choice(GIVEN)}"
        prev_sale = last_sale - timedelta(days=rnd.randint(900, 5000))
        sales_history = [
            {"recording_date": last_sale.isoformat(), "seller": prev_owner, "buyer": owner_name,
             "doc_type": "Warranty Deed", "amount": last_amount},
            {"recording_date": prev_sale.isoformat(), "seller": rnd.choice(LENDERS), "buyer": prev_owner,
             "doc_type": "Warranty Deed", "amount": round(last_amount * rnd.uniform(0.5, 0.85), -3)},
        ]

        # 估值与税：按州的每平尺单价区间生成，稳定可复现
        ppsf_range = {"CA": (560, 760), "KS": (140, 185), "MO": (125, 170)}.get(cand.state, (150, 220))
        ppsf = rnd.uniform(*ppsf_range)
        avm = round(sqft * ppsf / 1000) * 1000
        tax_rate = {"CA": 0.0075, "KS": 0.013, "MO": 0.011}.get(cand.state, 0.011)
        valuation = Valuation(
            avm_value=float(avm),
            avm_low=round(avm * 0.93 / 1000) * 1000,
            avm_high=round(avm * 1.07 / 1000) * 1000,
            list_price=round(avm * rnd.uniform(0.60, 0.78) / 500) * 500,   # 待翻新的房子通常按估值六到八折挂
            annual_tax=round(avm * tax_rate * rnd.uniform(0.85, 1.0) / 10) * 10,
            provider=self.name,
        )
        fields.append(FieldValue("avm_value", str(int(valuation.avm_value)), DEMO_SOURCE, None, "模型估值，接 HouseCanary 后替换为带置信区间的真值"))
        fields.append(FieldValue("list_price", str(int(valuation.list_price)), DEMO_SOURCE, None, "当前挂牌价"))
        fields.append(FieldValue("annual_tax", str(int(valuation.annual_tax)), DEMO_SOURCE, None))

        return PropertyLookupResult(
            address=cand, apn=apn, fields=fields, owner=owner,
            mortgages=mortgages, sales_history=sales_history, valuation=valuation, provider=self.name,
        )
