"""Resolve a user-supplied provider endpoint to public, pinned addresses."""
import asyncio
from ipaddress import IPv6Address, ip_address, ip_network
import socket

from aiohttp.abc import AbstractResolver
from yarl import URL


_PUBLIC_V6 = ip_network('2000::/3')
_V6_TRANSITION = (ip_network('2002::/16'), ip_network('2001::/32'))


def _is_public(address):
    if '%' in address:
        return False
    address = ip_address(address)
    if isinstance(address, IPv6Address):
        if address.ipv4_mapped is not None:
            address = address.ipv4_mapped
        elif address not in _PUBLIC_V6 or any(address in net for net in _V6_TRANSITION):
            return False
    return address.is_global and not address.is_multicast and not address.is_reserved


class PinnedProviderResolver(AbstractResolver):
    def __init__(self, host, port, addresses):
        self.host = host
        self.port = port
        self.addresses = addresses

    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        if (host, port) != (self.host, self.port):
            raise OSError('Unexpected provider destination')
        return [
            {'hostname': host, 'host': address, 'port': port, 'family': address_family,
             'proto': socket.IPPROTO_TCP, 'flags': socket.AI_NUMERICHOST}
            for address_family, address in self.addresses
            if family in (socket.AF_UNSPEC, address_family)
        ]

    async def close(self):
        pass


async def resolve_public_provider_url(value):
    if not value or any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in value) or '\\' in value:
        raise ValueError('Invalid provider URL')
    url = URL(value)
    host, port = url.raw_host, url.port
    if (url.scheme not in ('http', 'https') or not host or not port
            or url.raw_user is not None or url.raw_password is not None or '?' in value or '#' in value
            or '%' in host):
        raise ValueError('Invalid provider URL')
    try:
        literal = ip_address(host)
    except ValueError:
        literal = None
    # aiohttp bypasses DNS for IP-looking hosts. Reject noncanonical numeric
    # forms instead of relying on the OS and the connector to interpret them alike.
    if literal is None and (':' in host or host.replace('.', '').isdigit()):
        raise ValueError('Invalid provider address')
    if literal is not None and not _is_public(host):
        raise ValueError('Non-public provider address')
    domain = host.lower().rstrip('.')
    if literal is None and ('.' not in domain or domain.endswith(('.localhost', '.local', '.internal'))):
        raise ValueError('Non-public provider address')

    # Validate every DNS answer, then hand the same addresses to the connector.
    # Keeping the original URL preserves the Host header and TLS verification.
    answers = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP), timeout=5)
    addresses = tuple(dict.fromkeys((family, sockaddr[0]) for family, _, _, _, sockaddr in answers))
    if not addresses or any(not _is_public(address) for _, address in addresses):
        raise ValueError('Non-public provider address')
    return str(url).rstrip('/'), PinnedProviderResolver(host, port, addresses)
