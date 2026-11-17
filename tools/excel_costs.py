"""1.34: يقرأ أوراق التكاليف من ملف Excel المالك (الصيانة، غيار_الزيت، الكفرات، البطاريات) ويكتب JSON
جاهزاً لدالة sync_cost_lines(p_rows, p_sheets). المفتاح الثابت = اسم الورقة + رقم الصف.
Usage: python3 -I tools/excel_costs.py FILE.xlsx > rows.json"""
import sys, json, datetime
import openpyxl

# الورقة: (النوع، {الحقل: رقم العمود 1..})، والمبلغ إلزامي لاعتبار الصف سجلاً
SHEETS = {
    'الصيانة': ('maintenance', dict(plate=1, letters=2, company=3, site=4, brand=5, user_name=6, date=7, invoice_no=8, order_no=9,
                                    description=10, amount=11, payment_status=14, payment_method=15, payer=16, doc_type=17, attachment_url=19)),
    'غيار_الزيت': ('oil', dict(plate=1, letters=2, company=3, site=4, brand=5, user_name=6, date=7, odometer=8, description=9,
                               invoice_no=10, amount=11, notes=12, payment_status=13, payment_method=14, payer=15, doc_type=16, attachment_url=17)),
    'الكفرات': ('tires', dict(plate=1, letters=2, company=3, site=4, brand=5, user_name=6, date=7, description=8, quantity=9, supplier=10,
                              invoice_no=11, amount=12, payment_status=13, payment_method=14, payer=15, doc_type=16, attachment_url=17, notes=19)),
    'البطاريات': ('batteries', dict(plate=1, letters=2, company=3, site=4, brand=5, user_name=6, date=7, description=8, quantity=9, supplier=10,
                                    invoice_no=11, amount=12, payment_status=13, payment_method=14, payer=15, doc_type=16, attachment_url=17, notes=19)),
}


def txt(v):
    if v is None: return None
    if isinstance(v, float) and v.is_integer(): v = int(v)
    s = str(v).strip()
    return s or None


def read(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    rows, sheets = [], []
    for name, (cat, cols) in SHEETS.items():
        if name not in wb.sheetnames: continue
        ws = wb[name]; sheets.append(name)
        for r in range(2, ws.max_row + 1):
            g = {k: ws.cell(r, c).value for k, c in cols.items()}
            amt = g.get('amount')
            if not isinstance(amt, (int, float)): continue  # صف فارغ أو بدون مبلغ
            d = g.get('date')
            if isinstance(d, datetime.datetime): d = d.date()
            date = d.isoformat() if isinstance(d, datetime.date) else None
            plate = ' '.join(x for x in [txt(g.get('letters')), txt(g.get('plate'))] if x)
            note = txt(g.get('notes'))
            if g.get('odometer'): note = ' | '.join(x for x in [f"الممشى {txt(g['odometer'])}", note] if x)
            if g.get('order_no'): note = ' | '.join(x for x in [f"رقم الطلب {txt(g['order_no'])}", note] if x)
            att = txt(g.get('attachment_url'))
            rows.append(dict(category=cat, source_sheet=name, source_row=r, plate=plate or None, company=txt(g.get('company')),
                             site=txt(g.get('site')), brand=txt(g.get('brand')), user_name=txt(g.get('user_name')), date=date,
                             description=txt(g.get('description')), quantity=g.get('quantity') if isinstance(g.get('quantity'), (int, float)) else None,
                             supplier=txt(g.get('supplier')), invoice_no=txt(g.get('invoice_no')), amount=round(float(amt), 2),
                             payment_status=txt(g.get('payment_status')), payment_method=txt(g.get('payment_method')), payer=txt(g.get('payer')),
                             doc_type=txt(g.get('doc_type')), attachment_url=att if att and att.startswith('http') else None, notes=note))
    return rows, sheets


if __name__ == '__main__':
    rows, sheets = read(sys.argv[1])
    json.dump({'rows': rows, 'sheets': sheets}, sys.stdout, ensure_ascii=False)
