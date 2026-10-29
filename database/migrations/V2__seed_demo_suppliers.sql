-- Demo setup: the known suppliers of the fictional Maple Grove Dental Studio.
-- Same names and tax ids as demo/generate_invoices.py. Riverbend Promotional Goods is left out on purpose:
-- its invoices must go to review as an unknown supplier.

SET search_path TO invoicing;

INSERT INTO suppliers (name, tax_id) VALUES
  ('Summit Dental Supply, Inc.', '00-4417821'),
  ('ClearView Dental Lab LLC', '00-7302264'),
  ('Pacific Coast Medical Waste', '00-5568190'),
  ('BrightPath IT Services', '00-2093317'),
  ('Evergreen Office Products', '00-8841056'),
  ('Lakeside Uniform & Linen Co.', '00-6620478'),
  ('Northstar Equipment Repair', '00-3159902');
