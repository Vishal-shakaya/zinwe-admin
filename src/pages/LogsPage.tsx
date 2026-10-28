import type { ReactElement } from "react";
import { PageHeader } from "../components/PageHeader";
import { SampleTag } from "../components/States";

/** Logs (FR-37): placeholder until the board build lands. */
export function LogsPage(): ReactElement {
  return <PageHeader title="Logs" badge={<SampleTag />} />;
}
