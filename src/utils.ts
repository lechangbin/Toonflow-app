import db from "@/utils/db";
import oss from "@/utils/oss";
// import * as ai from "@/utils/ai";
import editImage from "@/utils/editImage";
import number2Chinese from "@/utils/number2Chinese";
import deleteOutline from "@/utils/deleteOutline";
import getConfig from "./utils/getConfig";
import { v4 as uuid } from "uuid";

import AIText from "@/utils/ai/text";
import generateVideo from "@/utils/ai/generateVideo";
import generateImage from "@/utils/ai/generateImage";
export default {
  db,
  oss,
  ai: {
    text: AIText,
    generateVideo,
    generateImage,
  },
  editImage,
  number2Chinese,
  deleteOutline,
  getConfig,
  uuid,
};
