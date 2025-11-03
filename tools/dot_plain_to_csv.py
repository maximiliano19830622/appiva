#!/usr/bin/env python3
"""
Convert Graphviz plain output (dot -Tplain) into layout_fields.csv used by the app.

Usage:
  python tools/dot_plain_to_csv.py input.plain server/assets/layout_fields.csv

Assumptions:
  - Input is Graphviz 'plain' format. Coordinates are in inches.
  - Origin is at bottom-left. We convert to mm and keep origin bottom-left.
  - The server code understands X/Y as mm, origin bottom-left (it inverts Y internally when drawing over page).

Node name mapping:
  We normalize node names to app keys when possible, but generally expect you
  to name nodes with keys the app recognizes: numero, numero_fact, fecha_cert, fecha_fact,
  proveedor_nombre, proveedor_direccion, proveedor_ciudad, proveedor_cuit, proveedor_codigo_postal,
  total_base, total_iva, total_abonado.
"""
import sys
import csv

def inch_to_mm(v: float) -> float:
    return float(v) * 25.4

def parse_plain(lines):
    width_in = height_in = None
    nodes = []
    for line in lines:
        parts = line.strip().split()
        if not parts:
            continue
        if parts[0] == 'graph':
            # graph width height
            if len(parts) >= 3:
                try:
                    width_in = float(parts[2])
                    height_in = float(parts[3]) if len(parts) >= 4 else None
                except Exception:
                    pass
        elif parts[0] == 'node':
            # node name x y width height label style shape color fillcolor
            if len(parts) >= 4:
                name = parts[1]
                try:
                    x = float(parts[2])
                    y = float(parts[3])
                except Exception:
                    continue
                nodes.append((name, x, y))
    return width_in, height_in, nodes

def main():
    if len(sys.argv) < 3:
        print("Usage: python tools/dot_plain_to_csv.py input.plain server/assets/layout_fields.csv", file=sys.stderr)
        sys.exit(2)
    inp = sys.argv[1]
    outp = sys.argv[2]
    with open(inp, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    w_in, h_in, nodes = parse_plain(lines)
    # Write CSV
    with open(outp, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['name','X (mm)','Y (mm)','font_pt','align','width_pt'])
        for name, x_in, y_in in nodes:
            x_mm = inch_to_mm(x_in)
            y_mm = inch_to_mm(y_in)
            # Default font and align; you can tweak after
            w.writerow([name, f"{x_mm:.2f}".replace('.',','), f"{y_mm:.2f}".replace('.',','), 12, 'left', ''])
    print(f"Wrote {outp} with {len(nodes)} nodes.")

if __name__ == '__main__':
    main()

