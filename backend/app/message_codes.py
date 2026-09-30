"""Additive display metadata for system errors; detail remains backward compatible."""
import json
import re
from pathlib import Path

_MESSAGES = json.loads(Path(__file__).with_suffix('.json').read_text())
_EXACT = {text: code for code, text in _MESSAGES.items() if '{{' not in text}
_PATTERNS = []
for code, text in _MESSAGES.items():
    if '{{' not in text:
        continue
    names = re.findall(r'\{\{(\w+)\}\}', text)
    parts = re.split(r'(\{\{\w+\}\})', text)
    pattern = ''.join('(.*?)' if re.fullmatch(r'\{\{\w+\}\}', part) else re.escape(part) for part in parts)
    _PATTERNS.append((code, names, re.compile('^' + pattern + '$', re.DOTALL)))


def message_metadata(detail):
    if not isinstance(detail, str):
        return {}
    if detail in _EXACT:
        return {'message_code': _EXACT[detail], 'message_params': {}}
    for code, names, pattern in _PATTERNS:
        match = pattern.fullmatch(detail)
        if match:
            return {'message_code': code, 'message_params': dict(zip(names, match.groups()))}
    return {}


def system_error(status_code: int, code: str, **params):
    """New errors use a stable code; retain original detail for older API clients."""
    from fastapi import HTTPException
    template = _MESSAGES[code]
    expected = set(re.findall(r'\{\{(\w+)\}\}', template))
    if set(params) != expected:
        raise TypeError(f'Message parameters do not match {code}')
    detail = re.sub(r'\{\{(\w+)\}\}', lambda match: str(params[match[1]]), template)
    exc = HTTPException(status_code=status_code, detail=detail)
    exc.message_code, exc.message_params = code, params
    return exc


def exception_metadata(exc):
    if getattr(exc, 'message_code', None) in _MESSAGES:
        return {'message_code': exc.message_code, 'message_params': exc.message_params}
    return message_metadata(exc.detail)
