/**
 * Server Groups — tag-to-server mapping
 *
 * Each key is a server name; the value is the list of OpenAPI tags
 * whose operations belong to that server.
 */

export const SERVER_GROUPS = {
    'okta-users': [
        'User', 'UserLifecycle', 'UserCred', 'UserFactor', 'UserGrant',
        'UserType', 'UserLinkedObject', 'UserOAuth', 'UserResources',
        'UserSessions', 'UserAuthenticatorEnrollments', 'UserClassification',
        'UserRisk', 'LinkedObject', 'Session', 'Group', 'GroupOwner', 'GroupRule',
    ],
    'okta-apps': [
        'Application', 'ApplicationConnections', 'ApplicationCrossAppAccessConnections',
        'ApplicationFeatures', 'ApplicationGrants', 'ApplicationGroups',
        'ApplicationLogos', 'ApplicationPolicies', 'ApplicationSSO',
        'ApplicationSSOCredentialKey', 'ApplicationSSOFederatedClaims',
        'ApplicationSSOPublicKeys', 'ApplicationTokens', 'ApplicationUsers',
        'OktaApplicationSettings', 'GroupPushMapping',
    ],

    'okta-idps': [
        'IdentityProvider', 'IdentityProviderKeys',
        'IdentityProviderSigningKeys', 'IdentityProviderUsers',
        'IdentitySource',
    ],
    'okta-security': [
        'Authenticator', 'Policy', 'AttackProtection', 'Behavior',
        'DeviceAssurance', 'DevicePostureCheck', 'ThreatInsight',
        'NetworkZone', 'CAPTCHA', 'WebAuthnPreregistration',
    ],
    'okta-roles': [
        'RoleAssignmentAUser', 'RoleAssignmentBGroup', 'RoleAssignmentClient',
        'RoleBTargetAdmin', 'RoleBTargetBGroup', 'RoleBTargetClient',
        'RoleCResourceSet', 'RoleCResourceSetResource',
        'RoleDResourceSetBinding', 'RoleDResourceSetBindingMember',
        'RoleECustom', 'RoleECustomPermission', 'GovernanceBundle',
    ],

    'okta-devices': [
        'Device', 'DeviceIntegrations', 'AgentPools', 'DirectoriesIntegration',
        'Realm', 'RealmAssignment', 'PushProvider', 'ServiceAccount',
    ],
};

/** Human-readable descriptions for each server */
export const SERVER_DESCRIPTIONS = {
    'okta-users': 'Users, Groups, Sessions, Factors, Credentials',
    'okta-apps': 'Applications, App SSO, App Users/Groups, Provisioning',
    'okta-idps': 'Identity Providers, IdP Keys, Identity Sources',
    'okta-security': 'Authenticators, Policies, Behavior, Network Zones, CAPTCHA',
    'okta-roles': 'Role Assignments, Targets, Resource Sets, Custom Roles',
    'okta-devices': 'Devices, Agent Pools, Realms, Push Providers',
};
