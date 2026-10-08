import { SimulationLab } from "@/components/ground/SimulationLab";

export const dynamic = "force-dynamic";

/** The node firmware running a whole site in the browser, on the 3D site, through the Pi's code. */
export default function GroundSimulationPage() {
  return <SimulationLab />;
}
