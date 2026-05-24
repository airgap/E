import { useEffect, useMemo, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

export default function TimerCloudscape() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const mm = useMemo(
    () =>
      Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0"),
    [seconds],
  );
  const ss = useMemo(() => (seconds % 60).toString().padStart(2, "0"), [seconds]);
  const display = useMemo(() => `${mm}:${ss}`, [mm, ss]);
  const progress = useMemo(() => ((seconds % 60) / 60) * 100, [seconds]);
  const phase = useMemo(() => (seconds === 0 ? "ready" : running ? "running" : "paused"), [seconds, running]);

  return (
    <Container
      header={
        <Header variant="h2" description="One signal drives every readout.">
          Session timer
        </Header>
      }
    >
      <SpaceBetween size="m">
        <Box variant="awsui-key-label">Elapsed</Box>
        <Box fontSize="display-l" fontWeight="bold">
          {display}
        </Box>
        <ProgressBar value={progress} description="Current minute" />
        <KeyValuePairs
          columns={3}
          items={[
            { label: "Total seconds", value: String(seconds) },
            { label: "Total minutes", value: mm },
            {
              label: "State",
              value: (
                <StatusIndicator type={phase === "running" ? "success" : phase === "paused" ? "pending" : "info"}>
                  {phase}
                </StatusIndicator>
              ),
            },
          ]}
        />
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={() => setRunning(r => !r)}>{running ? "Pause" : "Resume"}</Button>
          <Button variant="link" onClick={() => setSeconds(0)}>
            Reset
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );
}
