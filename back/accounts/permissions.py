from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import AccessLevel, Module


class IsAdministrator(BasePermission):
    message = "Acceso denegado."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_admin)


class HasRolePermission(BasePermission):
    message = "Acceso denegado."

    def has_permission(self, request, view):
        allowed_roles = getattr(view, "allowed_roles", ())
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_superuser or request.user.role in allowed_roles)
        )


class HasModulePermission(BasePermission):
    """Aplica los permisos por módulo del rol del usuario.

    La vista declara `module` (un valor de `accounts.models.Module`). Las lecturas
    necesitan "Solo ver" o "Ver y gestionar"; las escrituras, "Ver y gestionar".
    El administrador y el superusuario siempre tienen acceso total.
    """

    message = "Acceso denegado."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        level = user.access_level(view.module)
        if request.method in SAFE_METHODS:
            return level in (AccessLevel.VIEW, AccessLevel.MANAGE)
        return level == AccessLevel.MANAGE


class HasSSTPermission(BasePermission):
    """Restringe las consultas HU-25 al módulo de seguimiento SST."""

    message = "Se requiere permiso de consulta del módulo SST."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated
            and (user.is_admin or user.access_level(Module.SST) in (AccessLevel.VIEW, AccessLevel.MANAGE))
        )
