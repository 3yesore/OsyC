/**
 * 端点故障转移的判定与执行（纯函数 / 注入式 attempt，便于单测）。
 *
 * ## 为什么要分"能不能重试"，而不是失败就换端点
 *
 * - **网络层失败**（`requestUrl` 抛错）：请求没有完成，换端点重试安全；
 * - **502**：网关够不到后端，请求没有进应用，换端点重试安全；
 * - **503 / 504**：请求**可能已经进了应用**（504 尤其），所以只有幂等的 GET 才重试，
 *   避免把一个可能已经生效的 POST（例如 `/api/activate`）在另一个端点上再做一次；
 * - **其它状态码**（400/401/404/500…）：业务语义，换端点没有意义，原样交给调用方。
 *
 * ## 当前候选链（2026-09-20 定案：只走灰云直连，不走 Cloudflare）
 *
 * `resolveServiceCandidates` 目前只返回直连的 `api4.sacu3.cn` 一条，
 * Cloudflare 的 `api.sacu3.cn` / `osyctest.sacu3.cn` 已被排除
 * （见 serviceDefaults.ts 文件头；那里记了"把 CF 域名误当直连"的教训）。
 * 所以下面这套顺序回退逻辑是**为将来第二条直连入口预留的机制**，
 * 现在每条请求实际只会打一个端点；单测用合成的候选列表覆盖顺序与短路行为。
 */

/**
 * 这次失败要不要换下一条端点。
 *
 * @param status HTTP 状态码；请求没能完成时为 null
 * @param error  网络层错误；正常拿到响应时为 null
 * @param method 请求方法，用于判断能不能重试非幂等请求
 */
export function shouldTryNextEndpoint(status: number | null, error: unknown, method: string): boolean {
    if (error) return true;
    if (status === null) return false;
    if (status === 502) return true;
    if (status === 503 || status === 504) return method.trim().toUpperCase() === "GET";
    return false;
}

/** 一次放弃某个端点的记录，供调用方打日志。 */
export interface EndpointSkip {
    base: string;
    status: number | null;
    error: unknown;
}

/** 一次成功请求的结果：实际命中的端点 + 该端点返回的值。 */
export interface EndpointSuccess<T> {
    base: string;
    value: T;
    status: number;
}

/**
 * 按候选顺序尝试端点，遇到"可重试"的失败就换下一条；**第一条成功的就直接返回**，
 * 不会再去碰后面的端点（避免无谓重试放大请求）。
 *
 * 候选全部失败时：抛最后一次的网络错误（保留原始错误对象），
 * 若最后一次是状态码失败则抛聚合错误（带上已尝试的端点）。
 */
export async function tryEndpointsInOrder<T>(
    candidates: readonly string[],
    method: string,
    attempt: (base: string) => Promise<EndpointSuccess<T>>,
    onSkip?: (skip: EndpointSkip) => void
): Promise<EndpointSuccess<T>> {
    let lastStatus: number | null = null;
    let lastError: unknown = null;
    for (let index = 0; index < candidates.length; index += 1) {
        const base = candidates[index];
        try {
            const result = await attempt(base);
            if (index + 1 < candidates.length && shouldTryNextEndpoint(result.status, null, method)) {
                lastStatus = result.status;
                onSkip?.({ base, status: result.status, error: null });
                continue;
            }
            return result;
        } catch (error) {
            lastError = error;
            onSkip?.({ base, status: null, error });
        }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(
        `OsyC 端点均不可用（已尝试 ${candidates.join(", ")}），最后状态 ${String(lastStatus)}，最后错误 ${String(lastError)}`
    );
}
