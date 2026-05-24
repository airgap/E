import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

export default function AsyncCloudscape() {
  const [status, setStatus] = useState("idle");
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);

  // React has no async-block sugar, so the click handler nests the
  // async work in the `(async () => { … })()` IIFE by hand.
  const load = () => {
    setStatus("loading");
    (async () => {
      await new Promise(r => setTimeout(r, 600));
      setLastLoaded(new Date().toLocaleTimeString());
      setStatus("done");
    })();
  };

  return (
    <Container header={<Header variant="h2">Async loader</Header>}>
      <SpaceBetween size="m">
        <StatusIndicator type={status === "done" ? "success" : status === "loading" ? "in-progress" : "pending"}>
          {status === "loading" ? "Loading…" : status === "done" ? `Loaded ${lastLoaded}` : "Idle"}
        </StatusIndicator>
        <Box>
          <Button variant="primary" loading={status === "loading"} onClick={load}>
            Load data
          </Button>
        </Box>
      </SpaceBetween>
    </Container>
  );
}
