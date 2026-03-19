import db from "@/utils/db";
import oss from "@/utils/oss";
// import * as ai from "@/utils/ai";
import getConfig from "./utils/getConfig";
import { v4 as uuid } from "uuid";
import error from "@/utils/error";
import cleanNovel from "./utils/cleanNovel";
import getPath from "@/utils/getPath";
import vm from "@/utils/vm";
import { getPrompts } from "@/utils/getPrompts";
import task from "@/utils/taskRecord";
import Ai from "@/utils/ai";

export default {
  db,
  oss,
  getConfig,
  uuid,
  error,
  cleanNovel,
  vm,
  getPath,
  Ai,
  getPrompts,
  task,
};
