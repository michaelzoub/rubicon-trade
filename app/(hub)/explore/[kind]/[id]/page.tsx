import { AssetDetail } from "../../../_hub/asset-detail";

export default async function AssetPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  return <AssetDetail kind={kind === "crypto" ? "crypto" : "stock"} id={decodeURIComponent(id)} />;
}
