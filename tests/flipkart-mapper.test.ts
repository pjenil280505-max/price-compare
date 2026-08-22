/**
 * Runtime tests for the Flipkart mapper, driven by the EXACT sample payload
 * published in Flipkart's official API documentation. Run with:
 *   node --experimental-strip-types tests/flipkart-mapper.test.ts
 */
import { mapFlipkartProduct, type FkProductInfo } from "../lib/connectors/flipkart/mapper.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

// Verbatim from https://affiliate.flipkart.com/api-docs/af_prod_ref.html
// (v1.1.0 Product Feed API sample response).
const OFFICIAL_SAMPLE = {
  productBaseInfoV1: {
    productId: "TDHDMH5GRSPZ3DNM",
    title: "Newhide Designer",
    productDescription: "",
    imageUrls: {
      "400x400": "http://img.fkcdn.com/image/x-400x400-y.jpeg",
      "200x200": "http://img.fkcdn.com/image/x-200x200-y.jpeg",
      unknown: "http://img.fkcdn.com/image/x-original-y.jpeg",
      "800x800": "http://img.fkcdn.com/image/x-800x800-y.jpeg",
    },
    productFamily: null,
    maximumRetailPrice: { amount: 1145, currency: "INR" },
    flipkartSellingPrice: { amount: 1145, currency: "INR" },
    flipkartSpecialPrice: { amount: 999, currency: "INR" },
    productUrl: "http://dl.flipkart.com/dl/newhide-designer/p/itmdp2nunbzffwzr?pid=TDHDMH5GRSPZ3DNM&affid=keshav",
    productBrand: "Newhide",
    inStock: true,
    codAvailable: true,
    discountPercentage: 0,
    offers: [],
    categoryPath:
      '[[{"node_id":20001,"node_name":"FLIPKART_TREE"},{"node_id":21183,"node_name":"Lifestyle"},{"node_id":21960,"node_name":"Wallets \\u0026 Clutches"},{"node_id":21274,"node_name":"Wallets \\u0026 Card Wallets"}]]',
    styleCode: null,
    attributes: { size: "", color: "Black", storage: "", sizeUnit: "", displaySize: "" },
  },
  productShippingInfoV1: {
    shippingCharges: { amount: 0, currency: "INR" },
    sellerName: null,
    sellerAverageRating: 4.2,
    sellerNoOfRatings: 10,
    sellerNoOfReviews: 7,
  },
  categorySpecificInfoV1: {
    keySpecs: ["Passport Holder"],
    detailedSpecs: [],
    specificationList: [
      {
        key: "General",
        values: [
          { key: "Type", value: ["Passport Organizer"] },
          { key: "Style Code", value: ["CDBP040739"] },
        ],
      },
    ],
  },
} as unknown as FkProductInfo;

console.log("Flipkart mapper — official sample payload");
const mapped = mapFlipkartProduct(OFFICIAL_SAMPLE);

check("maps a valid product", mapped !== null);
if (mapped) {
  check("externalId = productId", mapped.externalId === "TDHDMH5GRSPZ3DNM", mapped.externalId);
  check("title mapped", mapped.title === "Newhide Designer", mapped.title);
  check("prefers specialPrice over sellingPrice", mapped.price === 999, mapped.price);
  check("mrp mapped", mapped.mrp === 1145, mapped.mrp);
  check("brand mapped", mapped.brand === "Newhide", mapped.brand);
  check("inStock mapped", mapped.inStock === true);
  check("codAvailable mapped", mapped.codAvailable === true);
  check("largest image first", mapped.imageUrls[0]?.includes("original"), mapped.imageUrls[0]);
  check("all 4 images kept", mapped.imageUrls.length === 4, mapped.imageUrls.length);
  check(
    "leaf category from JSON-encoded path, FLIPKART_TREE skipped",
    mapped.category === "Wallets & Card Wallets",
    mapped.category,
  );
  check("empty description -> undefined", mapped.description === undefined, mapped.description);
  check("GTIN is undefined (Flipkart publishes none)", mapped.gtin === undefined);
  check("specs flattened", mapped.specs["Type"] === "Passport Organizer", mapped.specs);
  check("variant attributes exclude empty strings", !("size" in mapped.variantAttributes), mapped.variantAttributes);
  check("variant color captured", mapped.variantAttributes.color === "Black");
  check("variantLabel built", mapped.variantLabel === "Black", mapped.variantLabel);
  check("rating from seller rating", mapped.rating === 4.2, mapped.rating);
  check("isAvailable defaults true when absent", mapped.isAvailable === true);
}

console.log("\nEdge cases");

// Missing required fields -> null, not a throw.
check("null on missing productId", mapFlipkartProduct({ productBaseInfoV1: { title: "x", productUrl: "u" } } as unknown as FkProductInfo) === null);
check("null on empty object", mapFlipkartProduct({} as FkProductInfo) === null);
check(
  "null when no price at all",
  mapFlipkartProduct({
    productBaseInfoV1: {
      productId: "A", title: "T", productUrl: "http://x", imageUrls: null,
      maximumRetailPrice: null, flipkartSellingPrice: null, flipkartSpecialPrice: null,
      attributes: null, categoryPath: null, productBrand: null, productDescription: null,
      inStock: null, codAvailable: null, discountPercentage: null, offers: null,
      productFamily: null, styleCode: null,
    },
  } as unknown as FkProductInfo) === null,
);

// Falls back to sellingPrice when specialPrice absent.
const noSpecial = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE)) as FkProductInfo;
noSpecial.productBaseInfoV1!.flipkartSpecialPrice = null;
const m2 = mapFlipkartProduct(noSpecial);
check("falls back to sellingPrice", m2?.price === 1145, m2?.price);

// Malformed categoryPath must not throw.
const badCat = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE)) as FkProductInfo;
badCat.productBaseInfoV1!.categoryPath = "{not valid json";
const m3 = mapFlipkartProduct(badCat);
check("malformed categoryPath -> undefined, no throw", m3 !== null && m3.category === undefined);

// Delta deletion signal.
const deleted = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE)) as FkProductInfo;
deleted.productBaseInfoV1!.isAvailable = false;
const m4 = mapFlipkartProduct(deleted);
check("isAvailable=false preserved (delta deletion)", m4?.isAvailable === false);

// MRP lower than price should not produce a fake discount.
const weird = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE)) as FkProductInfo;
weird.productBaseInfoV1!.maximumRetailPrice = { amount: 0, currency: "INR" };
const m5 = mapFlipkartProduct(weird);
check("zero MRP -> undefined (no fake discount)", m5?.mrp === undefined, m5?.mrp);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
