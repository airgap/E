import { useMemo, useState } from "react";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";

const splitList = (s: string) => s.split(",");
const clean = (s: string) => s.trim().toLowerCase();
const unique = <T,>(xs: T[]) => Array.from(new Set(xs));

export default function TagsCloudscape() {
  const [raw, setRaw] = useState("design, Engineering,  research , design, ops, ");
  // Same transforms as the Para side. With no pipeline operator the free
  // functions wrap the method chain inside-out: `unique` is read first but
  // runs after split/map/filter, and `.sort()` hangs off the outside.
  const tags = useMemo(
    () =>
      unique(
        splitList(raw)
          .map(clean)
          .filter(s => s.length > 0),
      ).sort(),
    [raw],
  );
  return (
    <Container
      header={
        <Header counter={`(${tags.length})`} variant="h2">
          Tag input
        </Header>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Comma-separated tags" description="Whitespace and case-folded, deduplicated, sorted.">
          <Input value={raw} onChange={({ detail }) => setRaw(detail.value)} placeholder="ui, infra, data" />
        </FormField>
        {tags.length > 0 ? (
          <Box>
            <SpaceBetween direction="horizontal" size="xs">
              {tags.map(t => (
                <Badge key={t} color="blue">
                  {t}
                </Badge>
              ))}
            </SpaceBetween>
          </Box>
        ) : (
          <Box color="text-status-inactive">No tags yet.</Box>
        )}
      </SpaceBetween>
    </Container>
  );
}
