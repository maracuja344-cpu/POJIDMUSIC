begin;

-- Artist access is administrative. A normal signed-in user must never be
-- able to promote their own listener profile through the legacy onboarding RPC.
revoke all on function public.activate_current_user_as_artist()
from public, anon, authenticated;

grant execute on function public.activate_current_user_as_artist()
to postgres, service_role;

commit;
