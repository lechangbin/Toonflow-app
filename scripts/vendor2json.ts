import fs from "fs";
import path from "path";
import { readReleasedVendorSources, validateReleaseBuildVendorData } from "../src/video/bootstrap";

validateReleaseBuildVendorData(path.resolve("data"));

const result = readReleasedVendorSources(path.join("data", "vendor"));
const outputPath = path.join("src", "lib", "vendor.json");
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
console.log(`Done, saved ${outputPath}`);
