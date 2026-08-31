class HenryError(Exception):
    """Base error for expected Henry failures."""


class MissionNotFound(HenryError):
    pass


class InvalidTransition(HenryError):
    pass


class VersionConflict(HenryError):
    pass


class BudgetExceeded(HenryError):
    pass
