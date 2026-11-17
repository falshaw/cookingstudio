// Optional shopping region (SHOP_REGION, e.g. "Canada" or "Chicago, USA"). Used only to word AI prompts
// and labels ("where to buy in …"); empty = generic wording. Never sent anywhere but the local model.
export function shopRegion(raw: string | undefined = process.env.SHOP_REGION): string {
  return (raw ?? "").trim().slice(0, 80);
}

/** " in <region>" or "" — for sentences like `shopping${inRegion()}`. */
export function inRegion(region: string = shopRegion()): string {
  return region ? ` in ${region}` : "";
}
