import { getDatabaseRuntime } from "@/database";

import { createCheckVideoPromptRouter } from "./checkVideoPromptRouter";

export default createCheckVideoPromptRouter((operation) => getDatabaseRuntime().work(operation));
