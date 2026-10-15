"""Generate the demo datasets in public/samples/ (synthetic, fixed seed).

loan_applications.csv  a messy auto-loan extract with the problems DataWhisperer should catch:
                       missing incomes, duplicate rows, untrimmed state codes, inconsistent
                       status labels, a few negative amounts, outliers, emails (PII), and a
                       ZIP column with "N/A" entries mixed in.
store_orders.csv       a clean e-commerce extract, to show what a healthy file looks like.

    python scripts/make_samples.py
"""

import csv
import os
import random
from datetime import date, datetime, timedelta

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "samples")
STATES = ["TX", "CA", "FL", "GA", "OH", "MI", "NC", "AZ", "IL", "PA", "NY", "MA"]
MAKES = ["Chevrolet", "GMC", "Buick", "Cadillac", "Toyota", "Ford", "Honda"]


def loans(rng: random.Random, n: int = 5000) -> None:
    rows = []
    for i in range(n):
        score = max(500, min(850, int(rng.gauss(690, 70))))
        income = round(rng.lognormvariate(11.1, 0.45), -2)
        amount = round(rng.uniform(8000, 65000), 2)
        if rng.random() < 0.004:
            amount = -amount  # sign error from an upstream system
        if rng.random() < 0.003:
            amount = round(amount * rng.uniform(8, 15), 2)  # fat-finger outlier
        status = rng.choices(["Approved", "Declined", "Pending"], [0.62, 0.28, 0.10])[0]
        if rng.random() < 0.05:
            status = status.lower() + rng.choice(["", " "])  # second source system
        state = rng.choice(STATES)
        if rng.random() < 0.04:
            state = f" {state}"
        applied = datetime(2025, 1, 1) + timedelta(minutes=rng.randint(0, 600 * 24 * 60))
        rows.append({
            "application_id": f"APP-{100000 + i}",
            "applied_at": applied.strftime("%Y-%m-%d %H:%M:%S"),
            "applicant_email": f"user{rng.randint(10000, 99999)}@example.com",
            "state": state,
            "zip_code": "N/A" if rng.random() < 0.01 else f"{rng.randint(10000, 99999)}",
            "credit_score": score,
            "annual_income": "" if rng.random() < 0.09 else income,
            "vehicle_make": rng.choice(MAKES),
            "vehicle_year": rng.randint(2016, 2026),
            "amount_requested": amount,
            "term_months": rng.choice([36, 48, 60, 72, 84]),
            "apr": round(rng.uniform(0.049, 0.229), 4),
            "status": status,
            "dealer_notes": "" if rng.random() < 0.97 else rng.choice(["Verify income", "Co-signer pending", "Trade-in"]),
            "source_system": "LOS",
        })
    rows += [dict(r) for r in rng.sample(rows, 40)]  # re-sent extract: exact duplicates
    rng.shuffle(rows)
    write("loan_applications.csv", rows)


def orders(rng: random.Random, n: int = 3000) -> None:
    rows = []
    start = date(2026, 1, 1)
    for i in range(n):
        qty = rng.choices([1, 2, 3, 4], [0.6, 0.25, 0.1, 0.05])[0]
        price = round(rng.uniform(5, 250), 2)
        rows.append({
            "order_id": 700000 + i,
            "order_date": (start + timedelta(days=rng.randint(0, 270))).isoformat(),
            "customer_id": rng.randint(1, 900),
            "channel": rng.choices(["web", "mobile_app", "marketplace"], [0.55, 0.35, 0.10])[0],
            "category": rng.choice(["electronics", "home", "outdoor", "apparel", "books"]),
            "quantity": qty,
            "unit_price": price,
            "order_total": round(qty * price, 2),
            "is_gift": rng.random() < 0.12,
        })
    write("store_orders.csv", rows)


def write(name: str, rows: list[dict]) -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{name}: {len(rows):,} rows")


if __name__ == "__main__":
    loans(random.Random(7))
    orders(random.Random(11))
