import { formatTraceSafeLog } from "@/diagnostics/traceSafeDiagnostics";

// 处理未捕获的 Promise 拒绝
process.on("unhandledRejection", (reason) => {
  const kind = reason instanceof Error ? reason.name : typeof reason;
  console.error(`[未处理的 Promise 拒绝] ${formatTraceSafeLog(kind)}`);
});

// 处理未捕获的异常
process.on("uncaughtException", (error) => {
  console.error(`[未捕获的异常] ${formatTraceSafeLog(error.name)}`);
});
