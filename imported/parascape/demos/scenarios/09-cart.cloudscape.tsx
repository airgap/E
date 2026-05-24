import { useMemo, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

type Line = { id: string; name: string; price: number; qty: number };

const TAX_RATE = 0.0875;

export default function CartCloudscape() {
  const [lines, setLines] = useState<Line[]>([
    { id: "a", name: "Sourdough loaf", price: 8, qty: 2 },
    { id: "b", name: "Salted butter", price: 6, qty: 1 },
    { id: "c", name: "Cold brew", price: 5, qty: 3 },
  ]);
  const [discountPct, setDiscountPct] = useState(0);

  const subtotal = useMemo(() => lines.reduce((a, l) => a + l.price * l.qty, 0), [lines]);
  const discount = useMemo(() => subtotal * (discountPct / 100), [subtotal, discountPct]);
  const preTax = useMemo(() => subtotal - discount, [subtotal, discount]);
  const tax = useMemo(() => preTax * TAX_RATE, [preTax]);
  const total = useMemo(() => preTax + tax, [preTax, tax]);
  const itemCount = useMemo(() => lines.reduce((a, l) => a + l.qty, 0), [lines]);

  const bump = (id: string, delta: number) =>
    setLines(cur => cur.map(l => (l.id === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l)));

  return (
    <Container
      header={
        <Header variant="h2" counter={`(${itemCount})`}>
          Cart
        </Header>
      }
    >
      <SpaceBetween size="m">
        <Table
          items={lines}
          variant="embedded"
          columnDefinitions={[
            { id: "name", header: "Item", cell: (l: Line) => l.name },
            { id: "price", header: "Price", cell: (l: Line) => `$${l.price}` },
            {
              id: "qty",
              header: "Qty",
              cell: (l: Line) => (
                <SpaceBetween direction="horizontal" size="xxs">
                  <Button onClick={() => bump(l.id, -1)} disabled={l.qty === 0}>
                    −
                  </Button>
                  <Box>{l.qty}</Box>
                  <Button onClick={() => bump(l.id, 1)}>+</Button>
                </SpaceBetween>
              ),
            },
            { id: "sub", header: "Subtotal", cell: (l: Line) => `$${(l.price * l.qty).toFixed(2)}` },
          ]}
        />
        <KeyValuePairs
          columns={2}
          items={[
            { label: "Subtotal", value: `$${subtotal.toFixed(2)}` },
            { label: `Discount (${discountPct}%)`, value: `−$${discount.toFixed(2)}` },
            { label: "Tax (8.75%)", value: `$${tax.toFixed(2)}` },
            { label: "Total", value: `$${total.toFixed(2)}` },
          ]}
        />
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={() => setDiscountPct(0)}>No discount</Button>
          <Button onClick={() => setDiscountPct(10)}>10% off</Button>
          <Button onClick={() => setDiscountPct(25)}>25% off</Button>
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );
}
