"""外部房产数据源的统一接口。真实源（RentCast / ATTOM / HouseCanary / Google）只需实现这个类。"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AddressCandidate:
    label: str
    street: str
    city: str
    state: str
    zip: str
    lat: Optional[float] = None
    lng: Optional[float] = None


@dataclass
class FieldValue:
    field: str
    value: Optional[str]
    source: str  # 取值见 dictionaries.SOURCES；模拟源发 demo，真实源才发 public_record / model
    confidence: Optional[float] = None
    note: Optional[str] = None


@dataclass
class Valuation:
    """估值与市场相关的“已知数据”，用于交易分析器预填。"""
    avm_value: Optional[float] = None      # 模型估值（修好后能卖的价的起点）
    avm_low: Optional[float] = None
    avm_high: Optional[float] = None
    list_price: Optional[float] = None     # 当前挂牌价 / 叫价
    annual_tax: Optional[float] = None     # 年房产税
    provider: str = "unknown"


@dataclass
class PropertyLookupResult:
    address: AddressCandidate
    apn: Optional[str]
    fields: list[FieldValue] = field(default_factory=list)
    owner: Optional[dict] = None
    mortgages: list[dict] = field(default_factory=list)
    sales_history: list[dict] = field(default_factory=list)
    valuation: Optional[Valuation] = None
    provider: str = "unknown"


class PropertyDataProvider:
    name = "base"

    def geocode(self, query: str) -> list[AddressCandidate]:
        raise NotImplementedError

    def lookup(self, address: str) -> PropertyLookupResult:
        raise NotImplementedError
