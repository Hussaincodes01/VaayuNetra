import { FlowDiagram } from "@/components/ground/FlowDiagram";

export const dynamic = "force-dynamic";

/** The full flow: satellite flag -> wind forecast -> node plan -> nodes -> mesh -> Pi -> SMS -> confirmation. */
export default function GroundFlowPage() {
  return <FlowDiagram />;
}
