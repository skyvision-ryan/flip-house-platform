"""数据源选择。

KAN-71 之前这里读了 PROVIDER 存进变量然后丢掉，无条件返回 Mock——设成 rentcast 也是模拟数据，
不报错不告警。现在按注册表取，未实现的取值直接抛，并由 main.py 在启动时调一次，让服务起不来
而不是「健康检查通过、向导已经死了」（/api/health 根本不碰 provider）。
"""

from ..settings import PROVIDER
from .base import PropertyDataProvider
from .mock import MockProvider

# 将来：加 "rentcast": RentCastProvider 等。键就是 PROVIDER 环境变量的合法取值。
REGISTRY: dict[str, type[PropertyDataProvider]] = {
    "mock": MockProvider,
}


def get_provider() -> PropertyDataProvider:
    name = (PROVIDER or "mock").strip().lower()
    cls = REGISTRY.get(name)
    if cls is None:
        raise RuntimeError(
            f"PROVIDER={PROVIDER!r} 未实现。支持的取值：{', '.join(sorted(REGISTRY))}。"
            "不会静默退回模拟数据。"
        )
    return cls()
