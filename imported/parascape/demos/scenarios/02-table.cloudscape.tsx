import { useMemo, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

type Row = {
  id: string;
  name: string;
  type: string;
  state: "Running" | "Stopped" | "Pending";
  az: string;
};
const data: Row[] = [
  { id: "i-0a1", name: "web-1", type: "t3.medium", state: "Running", az: "us-east-1a" },
  { id: "i-0b2", name: "web-2", type: "t3.medium", state: "Running", az: "us-east-1b" },
  { id: "i-0c3", name: "worker-1", type: "c6i.xlarge", state: "Stopped", az: "us-east-1a" },
  { id: "i-0d4", name: "db-primary", type: "r6g.large", state: "Running", az: "us-east-1c" },
  { id: "i-0e5", name: "db-replica", type: "r6g.large", state: "Pending", az: "us-east-1b" },
];
const stateType = (state: Row["state"]) =>
  state === "Running" ? "success" : state === "Stopped" ? "stopped" : "in-progress";

export default function TableCloudscape() {
  const [filter, setFilter] = useState("");
  const items = useMemo(() => data.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())), [filter]);
  return (
    <Table
      items={items}
      variant="container"
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button>Refresh</Button>
              <Button variant="primary">Launch</Button>
            </SpaceBetween>
          }
        >
          Instances
        </Header>
      }
      filter={
        <TextFilter
          filteringText={filter}
          filteringPlaceholder="Find instance"
          onChange={({ detail }) => setFilter(detail.filteringText)}
        />
      }
      columnDefinitions={[
        { id: "name", header: "Name", cell: (r: Row) => r.name },
        { id: "type", header: "Type", cell: (r: Row) => r.type },
        {
          id: "state",
          header: "State",
          cell: (r: Row) => <StatusIndicator type={stateType(r.state)}>{r.state}</StatusIndicator>,
        },
        { id: "az", header: "AZ", cell: (r: Row) => r.az },
      ]}
      empty={<Box textAlign="center">No instances match the filter.</Box>}
    />
  );
}
